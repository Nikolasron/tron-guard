const { TronWeb } = require('tronweb');
const axios = require('axios');

const TRONSCAN_API = 'https://apilist.tronscanapi.com';
const FULL_HOST = 'https://api.trongrid.io';
const TOKEN_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; 
const MAX_HOLDERS_TO_SCAN = 50; 

const tronWeb = new TronWeb({ fullHost: FULL_HOST });

async function getTokenHolders() {
    const url = `${TRONSCAN_API}/api/token_trc20/holders?start=0&limit=${MAX_HOLDERS_TO_SCAN}&contract_address=${TOKEN_CONTRACT}`;
    try {
        const { data } = await axios.get(url);
        return data && data.trc20_tokens ? data.trc20_tokens.map(h => h.holder_address) : [];
    } catch (err) { return []; }
}

async function getApprovalsForOwner(ownerAddress) {
    const url = `${TRONSCAN_API}/api/account/approve/list?address=${ownerAddress}&limit=100&start=0&type=token`;
    try {
        const { data } = await axios.get(url);
        return data && data.data ? data.data : [];
    } catch (err) { return []; }
}

async function isSpenderDangerous(spenderAddress) {
    try {
        const contractInfo = await tronWeb.trx.getContractInfo(spenderAddress);
        const abi = contractInfo.abi ? contractInfo.abi.entrys : null;
        if (!abi) return false;

        return abi.some(item => {
            if (!item.inputs || item.inputs.length < 3) return false;
            const isDangerousName = ['transferFrom', 'withdraw', 'withdrawERC20', 'safeTransferFrom'].includes(item.name);
            const addressCount = item.inputs.filter(i => i.type === 'address').length;
            const hasUint = item.inputs.some(i => i.type.startsWith('uint'));
            return isDangerousName && addressCount >= 2 && hasUint;
        });
    } catch (err) { return false; }
}

async function main() {
    console.log(`🔍 Starting automated scan...`);
    const holders = await getTokenHolders();
    console.log(`Found ${holders.length} holders to analyze.`);

    const dangerousSpenders = [];

    for (const owner of holders) {
        const approvals = await getApprovalsForOwner(owner);
        const activeApprovals = approvals.filter(a => {
            const val = a.allowance || a.value || a.amount || '0';
            if (String(val).toLowerCase().includes('unlimited')) return true;
            try { return BigInt(val) > 0n; } catch { return false; }
        });

        for (const approval of activeApprovals) {
            const spender = approval.spender || approval.approved_address;
            if (!spender) continue;

            const isDangerous = await isSpenderDangerous(spender);
            if (isDangerous) {
                dangerousSpenders.push({
                    owner: owner, spender: spender,
                    token: approval.tokenSymbol || 'USDT',
                    allowance: approval.allowance || approval.value,
                });
            }
        }
    }

    console.log('\n========================================');
    console.log('   🚨 HIGH-RISK SPENDER REPORT 🚨   ');
    console.log('========================================');

    if (dangerousSpenders.length > 0) {
        dangerousSpenders.forEach((item, index) => {
            console.log(`${index + 1}. Spender: ${item.spender}`);
            console.log(`   Owner: ${item.owner}`);
            console.log(`   Allowance: ${item.allowance}`);
            console.log('   ⚠️  Has active allowance and dangerous function signature.');
        });
    } else {
        console.log('✅ No dangerous spenders found in this batch.');
    }
}

main().catch(err => console.error(err.message));
