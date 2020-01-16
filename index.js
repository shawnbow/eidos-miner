#!/usr/bin/env node

const assert = require('assert');
const fetch = require('node-fetch'); // node only; not needed in browsers
const chalk = require('chalk');
const figlet = require('figlet');
const yargs = require('yargs');
// const getApiEndpoints = require('eos-endpoint').default;

const { Api, JsonRpc, RpcError } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig'); // development only
const { TextEncoder, TextDecoder } = require('util'); // node only; native TextEncoder/Decoder
const { isValidPrivate, privateToPublic } = require('eosjs-ecc');

const { argv } = yargs
  .options({
    account: {
      description: 'Your EOS account',
      type: 'string',
      demandOption: true,
    },
    private_key: {
      description: 'Your private key',
      type: 'string',
      demandOption: true,
    },
    mine_type: {
      description: '<EIDOS|POW>',
      type: 'string',
      demandOption: true,
    },
    num_actions: {
      description: 'The number of actions per transaction, 0 means automatic',
      type: 'number',
      default: 0,
    }
  })
  .check(function(argv) {
    if (!isValidPrivate(argv.private_key)) {
      throw new Error('Error: private_key is invalid!');
    }
    if (argv.mine_type !== 'EIDOS' && argv.mine_type !== 'POW') {
      throw new Error('Error: mine_type is invalid!');
    }
    return true;
  });

const account = argv.account;
const signatureProvider = new JsSignatureProvider([argv.private_key]);

const eos_token = {
  code: 'eosio.token',
  symbol: 'EOS',
}
const mine_token = {
  code: argv.mine_type === 'EIDOS' ? 'eidosonecoin' : 'eosiopowcoin',
  symbol: argv.mine_type,
}

const API_ENDPOINTS = [
  "https://eospush.tokenpocket.pro",
  'https://mainnet.eos.dfuse.io',
  "https://eos.greymass.com",
  "https://api.eosn.io",
  "http://openapi.eos.ren",
  "https://mainnet.meet.one",
  "https://nodes.get-scatter.com",
  "https://api1.eosasia.one",
  "https://mainnet-tw.meet.one",
  'https://eos.eoscafeblock.com',
  'https://api.eosdetroit.io',
  'https://eos.newdex.one',
  'https://api.eosnewyork.io',
  'https://api.main.alohaeos.com',
  'https://api.redpacketeos.com',
  'https://api.eoseoul.io',
  'https://eos.infstones.io',
  "https://api.eossweden.se",
  'https://api.eossweden.org',
  'https://mainnet.eoscannon.io',
  'https://bp.whaleex.com',
  'https://api.helloeos.com.cn',
  'https://api.zbeos.com',
  'https://api.eosrio.io',
  "https://mainnet.eoscanada.com",
  'https://api.eoslaomao.com',
  // 'http://peer1.eoshuobipool.com:8181',
  // 'https://api-mainnet.starteos.io',
  // 'https://api.eosbeijing.one',
];

/**
 * Create an Api object given an url.
 *
 * @param {string} url API endpoint
 */
function create_api(url) {
  const rpc = new JsonRpc(url, { fetch });
  const api = new Api({
    rpc,
    signatureProvider,
    textDecoder: new TextDecoder(),
    textEncoder: new TextEncoder(),
  });
  return api;
}

const APIs = API_ENDPOINTS.map(url => create_api(url));

function get_random_api() {
  const index = Math.floor(Math.random() * APIs.length);
  return APIs[index];
}

/**
 * @param {string} account - EOS account.
 * @param {JsonRpc} rpc - JsonRpc.
 */
async function query_eos_balance(account, rpc) {
  const balance_info = await rpc.get_currency_balance(eos_token.code, account, eos_token.symbol);
  const balance = parseFloat(balance_info[0].split(' ')[0]);
  return balance;
}

/**
 * @param {string} account - EOS account.
 * @param {JsonRpc} rpc - JsonRpc.
 */
async function query_mine_balance(account, rpc) {
  try {
    const balance_info = await rpc.get_currency_balance(mine_token.code, account, mine_token.symbol);
    const balance = parseFloat(balance_info[0].split(' ')[0]);
    return balance;
  } catch (e) {
    return 0;
  }
}

/**
 * @param {string} account - EOS account, 12 letters.
 * @param {JsonRpc} rpc - JsonRpc.
 */
async function get_cpu_rate(account, rpc) {
  const info = await rpc.get_account(account);
  return info.cpu_limit.used / info.cpu_limit.max;
}

/**
 * @param {number} cpu_rate - CPU ultilization rate.
 */
function format_cpu_rate(cpu_rate) {
  return (Math.floor(cpu_rate * 10000) / 100).toFixed(2);
}

/**
 * @param {string} account - EOS account, 12 letters.
 * @param {string} quantity - EOS quantity.
 * @returns {Object}
 */
function create_action(account, quantity = '0.0001') {
  assert(typeof quantity === 'string');

  return {
    account: eos_token.code,
    name: 'transfer',
    authorization: [
      {
        actor: account,
        permission: 'active',
      },
    ],
    data: {
      from: account,
      to: mine_token.code,
      quantity: `${quantity} ${eos_token.symbol}`,
      memo: '',
    },
  };
}

/**
 * @param {number} num_actions - Number of actions.
 * @param {string} account - EOS account, 12 letters.
 * @returns {Array<Object>}
 */
function create_actions(num_actions, account) {
  const quantities = Array(num_actions)
    .fill(0.0001)
    .map(x => x.toFixed(4));
  return quantities.map(quantity => create_action(account, quantity));
}


/**
 * @param {Array<Object>} actions - Number of actions.
 * @param {Api} api - EOS account, 12 letters.
 * @returns {Promise<Object|undefined>}
 */
let tx_pause = false;
async function run_transaction(actions, api, tx_op = {}) {
  if (tx_pause) {
    console.warn(chalk.yellow(`pause mine once: num_actions=${actions.length}, tx_op=${JSON.stringify(tx_op)}`));
    tx_pause = false;
    return;
  }

  try {
    const result = await api.transact(
      {
        ...tx_op,
        actions: actions,
      },
      {
        blocksBehind: 3,
        expireSeconds: 300,
      },
    );
    tx_pause = false;
    return result;
  } catch (e) {
    tx_pause = true;
    console.warn(chalk.red(e.json.error.code + '-' + e.json.error.name + '-' + e.json.error.what))
    return null;
    // if (e instanceof RpcError) {
    //   console.log(JSON.stringify(e.json, null, 2));
    //   return;
    // }
    // if (e.toString().includes('is greater than the maximum billable CPU time for the transaction')) {
    //   cpu_usage_exceeded = true;
    //   console.warn(chalk.red('CPU usage exceeded, will not send out a transaction this time'));
    //   return;
    // }
    // console.error(e);
  }
}

const CPU_RATE_EXPECTATION = 0.95; // we expect to keep CPU rate at 95%
const CPU_RATE_RED = 0.99; // Stop mining if CPU rate > 99%
const NUM_ACTIONS_MIN = 32;
const NUM_ACTIONS_MAX = 256;
let num_actions = NUM_ACTIONS_MIN;
let cpu_rate_ema_slow = 0.0; // decay rate 0.999, recent 1000 data points
let cpu_rate_ema_fast = 0.0; // decay rate 0.5, recent 2 data points

function adjust_num_actions() {
  console.info(
    `cpu_rate_ema_fast=${format_cpu_rate(cpu_rate_ema_fast)}%, cpu_rate_ema_slow=${format_cpu_rate(
      cpu_rate_ema_slow,
    )}%, num_actions=${num_actions}`,
  );
  if (cpu_rate_ema_fast < CPU_RATE_EXPECTATION) {
    num_actions = Math.min(Math.ceil(num_actions * 2), NUM_ACTIONS_MAX);
    console.info('Doubled num_actions, now num_actions=' + num_actions.toFixed(0));
  } else if (cpu_rate_ema_fast > CPU_RATE_RED) {
    num_actions = Math.max(Math.ceil(num_actions / 2), NUM_ACTIONS_MIN);
    console.info('Halved num_actions, now num_actions=' + num_actions.toFixed(0));
    // cpu_rate_ema_fast is in range [CPU_RATE_EXPECTATION, CPU_RATE_RED]
  } else {
    // CPU rate changes over 0.5%
    if (Math.abs(cpu_rate_ema_fast - cpu_rate_ema_slow) / cpu_rate_ema_slow > 0.001) {
      if (cpu_rate_ema_fast > cpu_rate_ema_slow) {
        if (num_actions > NUM_ACTIONS_MIN) {
          num_actions -= 1;
          console.info('Decreased num_actions by 1, now num_actions=' + num_actions.toFixed(0));
        }
      } else {
        if (num_actions < NUM_ACTIONS_MAX) {
          num_actions += 1;
          console.info('Increased num_actions by 1, now num_actions=' + num_actions.toFixed(0));
        }
      }
    } else {
      // do nothing
      console.info('No need to adjust num_actions');
    }
  }
}

async function run() {
  try {
    const api = get_random_api();
    const cpu_rate = await get_cpu_rate(account, api.rpc);
    // update EMA
    cpu_rate_ema_fast = 0.5 * cpu_rate_ema_fast + 0.5 * cpu_rate;
    cpu_rate_ema_slow = 0.999 * cpu_rate_ema_slow + 0.001 * cpu_rate;
    if (
      cpu_rate > CPU_RATE_RED ||
      cpu_rate_ema_fast > CPU_RATE_RED ||
      cpu_rate_ema_slow > CPU_RATE_RED
    ) {
      // 1- (CPU Usage of one transaction / Total time rented)
      // console.warn(chalk.red(`CPU is too busy, set num_actions = ${NUM_ACTIONS_MIN}.`));
      num_actions = NUM_ACTIONS_MIN;
    }

    const prev_balance = await query_mine_balance(account, get_random_api().rpc, { fetch });

    const actions = create_actions(num_actions, account);

    await run_transaction(actions, api, { max_cpu_usage_ms: Math.ceil(num_actions/5) + 3 } );

    const current_balance = await query_mine_balance(account, get_random_api().rpc, { fetch });
    const increased = (current_balance - prev_balance).toFixed(4);
    if (increased != '0.0000' && !increased.startsWith('-')) {
      console.info(
        chalk.green(`Mined ${(current_balance - prev_balance).toFixed(4)} ${mine_token.symbol}!`),
      );
    }
  } catch (e) {
    console.error(e);
  }
}

(async () => {
  console.info(chalk.green(figlet.textSync(`${mine_token.symbol}  Miner`)));

  const eos_balance = await query_eos_balance(account, get_random_api().rpc, {
    fetch,
  });
  console.info(`${eos_token.symbol} balance: ${eos_balance}`);

  const mine_balance = await query_mine_balance(account, get_random_api().rpc, { fetch });
  console.info(`${mine_token.symbol} balance: ${mine_balance}`);

  const cpu_rate = await get_cpu_rate(account, get_random_api().rpc);
  cpu_rate_ema_slow = cpu_rate;
  cpu_rate_ema_fast = cpu_rate;

  if (eos_balance < 0.001) {
    console.error(
      'Your EOS balance is too low, must be greater than 0.001 EOS, please deposit more EOS to your account.',
    );
    await new Promise(resolve => setTimeout(resolve, 60000)); // wait for 1 minute so that you have enough time to deposit EOS to your account
    return;
  }

  setInterval(run, 2000); // Mine per 2s

  if (argv.num_actions <= 0) {
    setInterval(adjust_num_actions, 30000); // adjust num_actions every 60 seconds
  } else {
    num_actions = argv.num_actions;
  }

  // setInterval(async () => {
  //   const api_endpoints = (await getApiEndpoints()).map(x => x.url);
  //   API_ENDPOINTS.splice(0, API_ENDPOINTS.length, ...api_endpoints);
  //   const apis = API_ENDPOINTS.map(url => create_api(url));
  //   APIs.splice(0, APIs.length, ...apis);
  // }, 1000 * 3600); // update API_ENDPOINTS and APIs every hour

})();
