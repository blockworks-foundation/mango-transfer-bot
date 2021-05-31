import { Connection, PublicKey } from '@solana/web3.js'
import { IDS, MangoClient, MangoInstructionLayout } from '@blockworks-foundation/mango-client'
import axios from 'axios';
import BN from 'bn.js'

let env = 'mainnet-beta'
let conn = new Connection(IDS.cluster_urls[env])
let mangoProgramId = new PublicKey(IDS[env].mango_program_id)
let mangoGroup = IDS[env].mango_groups['BTC_ETH_USDT']
let mangoGroupPk = new PublicKey(mangoGroup.mango_group_pk)
let symbols = Object.keys(mangoGroup.symbols)
let vaults = mangoGroup.vault_pks

async function fetchPrices() {
  const client = new MangoClient()
  const mangoGroupClient = await client.getMangoGroup(conn, mangoGroupPk)
  return await mangoGroupClient.getPrices(conn)
}

async function fetchTransactions(until: string): Promise<string> {
  let prices = await fetchPrices()
  let signatures = await conn.getConfirmedSignaturesForAddress2(mangoGroupPk, { until })
  for (let i = signatures.length - 1; i >= 0; i-=1) {
    let signature = signatures[i].signature
    let tx = await conn.getConfirmedTransaction(signature)
    for (let ins of tx?.transaction?.instructions || []) {
      if (ins.programId.equals(mangoProgramId)) {
        let log = {data: ins.data.toString('base64'), keys: ins.keys.map(k => k.pubkey.toBase58())}
        let decoded = MangoInstructionLayout.decode(ins.data)

        decoded.keys = ins.keys.map(k => k.pubkey.toBase58())
        let date = new Date(tx!.blockTime as number * 1000)
        decoded.date = date
        //console.log(date, tx?.slot, decoded, signature, log)

        if (decoded.Deposit) {
          let signer = ins.keys[2].pubkey
          let vault = ins.keys[4].pubkey
          let vaultIndex = vaults.indexOf(vault.toBase58())
          let currency = symbols[vaultIndex]
          let decimals = currency === "SOL" ? 9 : 6
          let quantity = toNumber(decoded.Deposit.quantity, decimals)
          let quantityUSD = quantity * prices[vaultIndex]
          let msg = `${signer.toBase58()} deposit ${quantity} ${currency} $${quantityUSD} ${signature}`
          console.log(date, tx?.slot, msg)
          //@ts-ignore
          if (quantityUSD >= process.env.MIN_TRANSFER_USD) {
            notify(msg)
          }
        } else if (decoded.Withdraw) {
          let signer = ins.keys[2].pubkey
          let vault = ins.keys[4].pubkey
          let vaultIndex = vaults.indexOf(vault.toBase58())
          let currency = symbols[vaultIndex]
          let decimals = currency === "SOL" ? 9 : 6
          let quantity = toNumber(decoded.Withdraw.quantity, decimals)
          let quantityUSD = quantity * prices[vaultIndex]
          let msg = `${signer.toBase58()} withdraw ${quantity} ${currency} $${quantityUSD} ${signature}`
          console.log(date, tx?.slot, msg)
          //@ts-ignore
          if (quantityUSD >= process.env.MIN_TRANSFER_USD) {
            notify(msg)
          }
        }
      }
      await sleep(500)
    }
  }

  return signatures.length > 0 ? signatures[0].signature : until;
}

function notify(content: string) {
  if (process.env.WEBHOOK_URL) {
    axios.post(process.env.WEBHOOK_URL, {content});
  }
}

function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

function toNumber(bn: BN, decimals: number): number {
  let base = new BN(10).pow(new BN(decimals))
  let a = bn.div(base).toNumber()
  let b = bn.mod(base).toNumber() / Math.pow(10, decimals)
  return a + b
}

async function watchTransactions() {
  let signatures = await conn.getConfirmedSignaturesForAddress2(mangoGroupPk, { limit: 1 })
  let lastSignature = signatures[0].signature
  while (true) {
    lastSignature = await fetchTransactions(lastSignature)
    await sleep(2000)
  }
}

watchTransactions()
