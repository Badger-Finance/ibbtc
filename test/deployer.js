const { expect } = require("chai");
const { BigNumber } = ethers

const blockNumber = 12080365
const wbtcWhaleBalance = BigNumber.from(150).mul(1e8) // wbtc has 8 decimals
const wBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
const wBTCWhale = '0x875abe6f1e2aba07bed4a3234d8555a0d7656d12'
const signer = ethers.provider.getSigner(wBTCWhale)

const deployer = '0x08F7506E0381f387e901c9D0552cf4052A0740a4'

const crvPools = {
    sbtc: {
        lpToken: '0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3', // crvRenWSBTC
        swap: '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714',
        sett: '0xd04c48A53c111300aD41190D63681ed3dAd998eC'
    },
    ren: {
        lpToken: '0x49849C98ae39Fff122806C06791Fa73784FB3675', // crvRenWBTC
        swap: '0x93054188d876f558f4a66B2EF1d97d16eDf0895B',
        sett: '0x6dEf55d2e18486B9dDfaA075bc4e4EE0B28c1545'
    },
    tbtc: {
        lpToken: '0x64eda51d3Ad40D56b9dFc5554E06F94e1Dd786Fd', // tbtc/sbtcCrv
        swap: '0xC25099792E9349C7DD09759744ea681C7de2cb66',
        sett: '0xb9D076fDe463dbc9f915E5392F807315Bf940334'
    }
}

async function setupMainnetContracts(feeSink) {
    await network.provider.request({
        method: "hardhat_reset",
        params: [{
            forking: {
                jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY}`,
                blockNumber // having a consistent block number speeds up the tests across runs
            }
        }]
    })
    await impersonateAccount(wBTCWhale)

    if (process.env.DRYRUN === 'true') {
        const config = require('../deployments/mainnet.json')
        console.log('Using deployed contracts', config)

        await impersonateAccount(deployer)
        let core = await ethers.getContractAt('UpgradableProxy', config.core)
        let badgerPeak = await ethers.getContractAt('UpgradableProxy', config.badgerPeak)
        await core.connect(ethers.provider.getSigner(deployer)).transferOwnership((await ethers.getSigners())[0].address)
        await badgerPeak.connect(ethers.provider.getSigner(deployer)).transferOwnership((await ethers.getSigners())[0].address)

        return {
            badgerPeak: await ethers.getContractAt('BadgerSettPeak', config.badgerPeak),
            bBTC: await ethers.getContractAt('bBTC', config.bBtc),
            core: await ethers.getContractAt('Core', config.core)
        }
    } else {
        const [ UpgradableProxy, BadgerSettPeak, Core, BBTC ] = await Promise.all([
            ethers.getContractFactory('UpgradableProxy'),
            ethers.getContractFactory('BadgerSettPeak'),
            ethers.getContractFactory('Core'),
            ethers.getContractFactory('bBTC'),
        ])
        let [ core, badgerPeak ] = await Promise.all([
            UpgradableProxy.deploy(),
            UpgradableProxy.deploy()
        ])
        const bBTC = await BBTC.deploy(core.address)
        await core.updateImplementation((await Core.deploy(bBTC.address)).address)
        await badgerPeak.updateImplementation((await BadgerSettPeak.deploy(core.address)).address)
        ;([ core, badgerPeak ] = await Promise.all([
            ethers.getContractAt('Core', core.address),
            ethers.getContractAt('BadgerSettPeak', badgerPeak.address),
        ]))
        await Promise.all([
            core.whitelistPeak(badgerPeak.address),
            core.setConfig(10, 10, feeSink)
        ])
        return { badgerPeak, bBTC, core }
    }
}

async function getPoolContracts(pool) {
    return Promise.all([
        ethers.getContractAt('CurveLPToken', crvPools[pool].lpToken),
        ethers.getContractAt('ISwap', crvPools[pool].swap),
        ethers.getContractAt('ISett', crvPools[pool].sett)
    ])
}

async function mintCrvPoolToken(pool, account, a) {
    const [ _wBTC, _lpToken ] = await Promise.all([
        ethers.getContractAt('IERC20', wBTC),
        ethers.getContractAt('IERC20', crvPools[pool].lpToken)
    ])
    const amount = wbtcWhaleBalance.div(10)
    let _deposit, _amounts
    switch (pool) {
        case 'ren':
            _deposit = await ethers.getContractAt('renDeposit', crvPools.ren.swap)
            _amounts = [0, amount] // [ ren, wbtc ]
            break
        case 'sbtc':
            _deposit = await ethers.getContractAt('sbtcDeposit', crvPools.sbtc.swap)
            _amounts = [0, amount, 0] // [ ren, wbtc, sbtc ]
            break
        case 'tbtc':
            _deposit = await ethers.getContractAt('tbtcDeposit', '0xaa82ca713D94bBA7A89CEAB55314F9EfFEdDc78c')
            _amounts = [0, 0, amount, 0] // [ tbtc, ren, wbtc, sbtc ]
    }
    await _wBTC.connect(signer).approve(_deposit.address, amount)
    await _deposit.connect(signer).add_liquidity(_amounts, 0)
    await _lpToken.connect(signer).transfer(account, a)
}

async function getWbtc(account, amount) {
    const _wBTC = await ethers.getContractAt('IERC20', wBTC)
    await _wBTC.connect(signer).transfer(account, amount)
    return _wBTC
}

async function setupContracts(feeSink) {
    const [ UpgradableProxy, BadgerSettPeak, Core, BBTC, CurveLPToken, Swap, Sett ] = await Promise.all([
        ethers.getContractFactory("UpgradableProxy"),
        ethers.getContractFactory("BadgerSettPeak"),
        ethers.getContractFactory("Core"),
        ethers.getContractFactory("bBTC"),
        ethers.getContractFactory("CurveLPToken"),
        ethers.getContractFactory("Swap"),
        ethers.getContractFactory("Sett")
    ])
    let core = await UpgradableProxy.deploy()
    const [ bBTC, curveLPToken, swap ] = await Promise.all([
        BBTC.deploy(core.address),
        CurveLPToken.deploy(),
        Swap.deploy(),
    ])
    await core.updateImplementation((await Core.deploy(bBTC.address)).address)
    core = await ethers.getContractAt('Core', core.address)

    let badgerPeak = await UpgradableProxy.deploy()
    await badgerPeak.updateImplementation((await BadgerSettPeak.deploy(core.address)).address)
    badgerPeak = await ethers.getContractAt('BadgerSettPeak', badgerPeak.address)

    const sett = await Sett.deploy(curveLPToken.address)
    expect(await core.peaks(badgerPeak.address)).to.eq(0) // Extinct
    await Promise.all([
        core.whitelistPeak(badgerPeak.address),
        core.setConfig(10, 10, feeSink), // 0.1% fee
        badgerPeak.modifyWhitelistedCurvePools([{ swap: swap.address, sett: sett.address }])
    ])
    expect(await core.peaks(badgerPeak.address)).to.eq(1) // Active
    return { badgerPeak, curveLPToken, bBTC, sett, swap, core }
}

async function impersonateAccount(account) {
    await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [account],
    })
}

module.exports = {
    setupContracts,
    setupMainnetContracts,
    getPoolContracts,
    mintCrvPoolToken,
    impersonateAccount,
    getWbtc,
    crvPools
}
