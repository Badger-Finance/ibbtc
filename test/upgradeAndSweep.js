const { expect } = require("chai");
const { impersonateAccount } = require('./utils');

const dotenv = require('dotenv');
dotenv.config();

const PEAK_ADDRESS = "0x41671BA1abcbA387b9b2B752c205e22e916BE6e3";
const CORE_ADDRESS = "0x2A8facc9D49fBc3ecFf569847833C380A13418a8";
const BVE_CVX = "0xfd05D3C7fe2924020620A8bE4961bBaA747e6305";
const TREASURY_VAULT = "0xD0A7A8B98957b9CD3cFB9c0425AbE44551158e9e";
const SHARED_GOV = "0xCF7346A5E41b0821b80D5B3fdc385EEB6Dc59F44"; // proxyOwner and Peak's governance
const BREN_CRV = "0x6dEf55d2e18486B9dDfaA075bc4e4EE0B28c1545";

const ADRESS_ZERO = "0x0000000000000000000000000000000000000000";

// Sends test ether from test account
async function get_test_ether(account, amount="100") { 
    const test_account = (await ethers.getSigners())[0];
    await test_account.sendTransaction({
        to: account,
        value: ethers.utils.parseEther(amount)
    })
};

describe('BadgerSettPeak Upgrade and Sweep', function() {
    before('Fork chain', async function() {
        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY}`,
                }
            }]
        })
    });

    it('Upgrades correctly and sweep bveCVX', async function() {
        await impersonateAccount(SHARED_GOV);
        await get_test_ether(SHARED_GOV)
        const gov = ethers.provider.getSigner(SHARED_GOV);

        const [ BadgerSettPeak ] = await Promise.all([
            ethers.getContractFactory("BadgerSettPeak")
        ]);
    
        let badgerPeak = await ethers.getContractAt(
            'BadgerSettPeak', 
            PEAK_ADDRESS
        ); // Current deployment
    
        // Get storage variables
        const core = await badgerPeak.core();
        const numPools = await badgerPeak.numPools();
        const owner = await badgerPeak.owner();
        const pools = [];
        for (let i = 0; i < numPools; i++) {
            pools[i] = await badgerPeak.pools[i]
        };
        const portfolioValue = await badgerPeak.portfolioValue();
    
        // Upgrade contract
        badgerPeak = await ethers.getContractAt('UpgradableProxy', PEAK_ADDRESS);
        await badgerPeak.connect(gov)
                        .updateImplementation((await BadgerSettPeak.deploy(CORE_ADDRESS)).address);
        badgerPeak = await ethers.getContractAt('BadgerSettPeak', PEAK_ADDRESS);

        // Check that storage variables remain unchanged
        expect(await badgerPeak.core()).to.eq(core);
        expect(await badgerPeak.numPools()).to.eq(numPools);
        expect(await badgerPeak.owner()).to.eq(owner);
        for (i = 0; i < numPools; i++) {
            expect(await badgerPeak.pools[i]).to.eq(pools[i]);
        };
        expect(await badgerPeak.portfolioValue()).to.eq(portfolioValue);

        // Check that bveCVX sweeping works as expected   
        const bveCVX = await ethers.getContractAt('IERC20', BVE_CVX);

        const initial_peak_balance = await bveCVX.balanceOf(PEAK_ADDRESS);
        const initial_vault_balance = await bveCVX.balanceOf(TREASURY_VAULT);

        await badgerPeak.connect(gov)
                        .sweepUnprotectedToken(BVE_CVX, TREASURY_VAULT);

        const final_peak_balance = await bveCVX.balanceOf(PEAK_ADDRESS);
        const final_vault_balance = await bveCVX.balanceOf(TREASURY_VAULT);

        expect(final_peak_balance).to.eq(0);
        expect(final_vault_balance).to.eq(initial_peak_balance.add(initial_vault_balance));
    });

    it('Reverts when sweeping pool contracts', async function() {
        await impersonateAccount(SHARED_GOV);
        await get_test_ether(SHARED_GOV);
        const gov = ethers.provider.getSigner(SHARED_GOV);

        const [ BadgerSettPeak ] = await Promise.all([
            ethers.getContractFactory("BadgerSettPeak")
        ]);

        // Upgrade contract
        badgerPeak = await ethers.getContractAt('UpgradableProxy', PEAK_ADDRESS);
        await badgerPeak.connect(gov)
                        .updateImplementation((await BadgerSettPeak.deploy(CORE_ADDRESS)).address);
        badgerPeak = await ethers.getContractAt('BadgerSettPeak', PEAK_ADDRESS);

        // Currently only brenCrv
        await expect(
            badgerPeak.connect(gov).sweepUnprotectedToken(BREN_CRV, TREASURY_VAULT)
        ).to.be.revertedWith('PROTECTED_TOKEN');     
    });

    it('Reverts with address zeros', async function() {
        await impersonateAccount(SHARED_GOV);
        await get_test_ether(SHARED_GOV);
        const gov = ethers.provider.getSigner(SHARED_GOV);

        const [ BadgerSettPeak ] = await Promise.all([
            ethers.getContractFactory("BadgerSettPeak")
        ]);

        // Upgrade contract
        badgerPeak = await ethers.getContractAt('UpgradableProxy', PEAK_ADDRESS);
        await badgerPeak.connect(gov)
                        .updateImplementation((await BadgerSettPeak.deploy(CORE_ADDRESS)).address);
        badgerPeak = await ethers.getContractAt('BadgerSettPeak', PEAK_ADDRESS);

        await expect(
            badgerPeak.connect(gov).sweepUnprotectedToken(ADRESS_ZERO, TREASURY_VAULT)
        ).to.be.revertedWith('NULL_ADDRESS');     

        await expect(
            badgerPeak.connect(gov).sweepUnprotectedToken(BVE_CVX, ADRESS_ZERO)
        ).to.be.revertedWith('NULL_ADDRESS'); 
    });

    it('Reverts when called by rando', async function() {
        await impersonateAccount(SHARED_GOV);
        await get_test_ether(SHARED_GOV);
        const gov = ethers.provider.getSigner(SHARED_GOV);

        const [ BadgerSettPeak ] = await Promise.all([
            ethers.getContractFactory("BadgerSettPeak")
        ]);

        // Upgrade contract
        badgerPeak = await ethers.getContractAt('UpgradableProxy', PEAK_ADDRESS);
        await badgerPeak.connect(gov)
                        .updateImplementation((await BadgerSettPeak.deploy(CORE_ADDRESS)).address);
        badgerPeak = await ethers.getContractAt('BadgerSettPeak', PEAK_ADDRESS);  

        const rando = (await ethers.getSigners())[1];

        await expect(
            badgerPeak.connect(rando).sweepUnprotectedToken(BVE_CVX, TREASURY_VAULT)
        ).to.be.revertedWith('NOT_OWNER'); 
    });
});