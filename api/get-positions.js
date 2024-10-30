import { ethers } from 'ethers'
const ABI = require('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json')

const SUPPORTED_CHAINS = ['Arbitrum', 'Base']

const ENDPOINTS = {
    Base: {
        infura: 'https://base-mainnet.infura.io/v3/',
        uniNFTObserver: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    },
    Arbitrum: {
        infura: 'https://arbitrum-mainnet.infura.io/v3/',
        uniNFTObserver: '0xc36442b4a4522e871399cd717abdd847ab11fe88',
    },
}

const FEE_AMOUNT_MAX = "340282366920938463463374607431768211455"

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { userAddress } = req.body;

    if (!userAddress) {
        return res.status(400).json({ error: 'userAddress is required' });
    }

    try {
        const positions = []

        for (const chain of SUPPORTED_CHAINS) {
            const infuraURL = `${ENDPOINTS[chain]['infura']}${process.env.INFURA_KEY}`
            const provider = new ethers.providers.JsonRpcProvider(infuraURL)
            const contract = new ethers.Contract(ENDPOINTS[chain]['uniNFTObserver'], ABI, provider)

            const balance = await contract.balanceOf(userAddress)

            const tokenIdPromises = []

            for (let i = 0; i < balance; i++) {
                tokenIdPromises.push(contract.tokenOfOwnerByIndex(userAddress, i))
            }

            const tokenIds = await Promise.all(tokenIdPromises)

            const positionPromises = tokenIds.map((tokenId) => contract.positions(tokenId))
            const positionsData = await Promise.all(positionPromises)

            const chainPostions = positionsData.map((position, index) => ({ tokenId: tokenIds[index], ...position, chain }))

            const nonEmptyPositions = chainPostions.filter(({liquidity}) => liquidity._hex !== '0x00')
            const emptyPositions = chainPostions.filter(({liquidity}) => liquidity._hex === '0x00')

            // request fees only for nonEmptyPositons
            const feePromises = nonEmptyPositions
                .map(({tokenId}) => contract.callStatic.collect({
                    tokenId,
                    recipient: userAddress,
                    amount0Max: FEE_AMOUNT_MAX,
                    amount1Max: FEE_AMOUNT_MAX
                }))

            const feeData = await Promise.all(feePromises)

            const positionsWithFees = nonEmptyPositions
                .map((pos, index) => ({
                    ...pos,
                    uncollectedFees: feeData[index]
                }))

            positions.push(...positionsWithFees, ...emptyPositions)
        }

        res.status(200).json(positions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
