import 'dotenv/config'
import solc from 'solc'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// 1) 环境变量
const rpcUrl = process.env.RPC_URL
const privateKey = process.env.PRIVATE_KEY
const toAddress = process.env.TO_ADDRESS

if (!rpcUrl || !privateKey || !toAddress) {
  throw new Error('请检查 .env 中是否配置了 RPC_URL / PRIVATE_KEY / TO_ADDRESS')
}

// 2) 账户
const account = privateKeyToAccount(
  privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
)

// 3) Client
const publicClient = createPublicClient({
  chain: foundry,
  transport: http(rpcUrl),
})

const walletClient = createWalletClient({
  account,
  chain: foundry,
  transport: http(rpcUrl),
})

// 4) Solidity 源码
const source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public number;

    constructor(uint256 initialNumber) {
        number = initialNumber;
    }

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number += 1;
    }
}
`

// 5) 编译合约
function compileContract() {
  const input = {
    language: 'Solidity',
    sources: {
      'Counter.sol': {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    const errors = output.errors.filter((e) => e.severity === 'error')
    if (errors.length > 0) {
      console.error(errors)
      throw new Error('Solidity 编译失败')
    }
  }

  const contract = output.contracts['Counter.sol']['Counter']
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  }
}

async function main() {
  console.log('当前账户:', account.address)

  // A. 连接链 + 基本查询
  const chainId = await publicClient.getChainId()
  const blockNumber = await publicClient.getBlockNumber()
  const balance = await publicClient.getBalance({ address: account.address })
  const nonce = await publicClient.getTransactionCount({ address: account.address })

  console.log('\n=== 基本数据查询 ===')
  console.log('chainId =', chainId)
  console.log('latestBlock =', blockNumber.toString())
  console.log('balance =', formatEther(balance), 'ETH')
  console.log('nonce =', nonce)

  // B. 发送普通转账交易
  console.log('\n=== 发送普通交易 ===')
  const txHash = await walletClient.sendTransaction({
    account,
    to: toAddress,
    value: parseEther('0.001'),
  })

  console.log('转账 txHash =', txHash)

  const txReceipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  })

  console.log('转账已确认, blockNumber =', txReceipt.blockNumber.toString())

  // C. 编译并部署合约
  console.log('\n=== 编译并部署合约 ===')
  const { abi, bytecode } = compileContract()

  const deployHash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [100n], // 初始值
    account,
  })

  console.log('部署 txHash =', deployHash)

  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  })

  const contractAddress = deployReceipt.contractAddress
  if (!contractAddress) {
    throw new Error('未拿到合约地址')
  }

  console.log('合约地址 =', contractAddress)

  // D. 读取合约状态
  console.log('\n=== 读取合约状态 ===')
  const value1 = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'number',
  })

  console.log('初始 number =', value1.toString())

  // E. 更新合约状态：setNumber
  console.log('\n=== 更新合约状态: setNumber(999) ===')
  const writeHash1 = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: 'setNumber',
    args: [999n],
    account,
  })

  console.log('setNumber txHash =', writeHash1)

  await publicClient.waitForTransactionReceipt({
    hash: writeHash1,
  })

  const value2 = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'number',
  })

  console.log('更新后 number =', value2.toString())

  // F. 再更新一次：increment
  console.log('\n=== 更新合约状态: increment() ===')
  const writeHash2 = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName: 'increment',
    account,
  })

  console.log('increment txHash =', writeHash2)

  await publicClient.waitForTransactionReceipt({
    hash: writeHash2,
  })

  const value3 = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: 'number',
  })

  console.log('再次读取 number =', value3.toString())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})