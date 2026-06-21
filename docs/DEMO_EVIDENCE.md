# Predict Studio Demo Evidence

Generated: 2026-06-11T06:37:18.673Z

## Live proof

Command: `pnpm live:proof`
Exit: `0`

```text
Live proof summary
package:          0xad53c91cb1181690ddd3c0785d64615c425075eb8c555f812181f59541e7758f
manager:          0xd39a2f71907d2a577694525176d976973335cc0836ce3d1fb2a2a149689e9341
vault:            0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
publish:          145VJgqGLRyrmkCVFUuJfz3g1SeR69M8SW7vkWn5hSZH
sample mint:      7AHeK1yGErrNUwnd8ZAhtTZ3pY4VpDVWC9ZtcyLsbHC9
sample position:  0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95
sample settle:    3bafswkWphUEzUFkeCvfArhFe78ndcPgvgYoZyrLYCra payout=0 pnl=-524201
vault roll:       GDCEH8qro2ueVpEuzRXZjgFSywVd6P98x2GTJkyfA5M9
vault position:   0x6d1f4514a140dd35d548aa49292486e58cd7fe6a66366b244054fe1a5273b299
vault settle:     7cGNwsGmo2i7wnogcKtf4869a1HrHM6dPiMqH3qMRLqR payout=1000000 pnl=+472196
k2 package:       0x3925e59c067dbf176f6d4134427c1bd1332f5fb15c85a6df86f3465763ae0f24
k2 note market:   0x22f9ed4a57aaa281c967b3383b5377ca9ce13d5bab90e08e5260563425f5a556
k2 create market: 2XkV5RWiaGyUbxErqY1a79AZFdjH38jX6Ek66xyYgb8p
k2 seed market:   6G4zMt9PSjAyyV5tZYq8Gwu4cw6TLgvyZtKqKxccke4c
k2 mint+borrow:   J1tUZaHP47HZFsw4XWz5e23Sg2KRyWyXmTSbLB2kptow
k2 note borrow:   0x53a04bdf25d830be3347097e35752de283a14faae1e700445100fb090993ab71
k2 repay+reclaim: 3Zx1QbGhrmNgheiF1xvDGFAaepbMTaCrG1hz8Kd6fZri
k2 reclaimed note: 0xd87058d3ac7b5aa392371ad4eeb1ecdddba338a996ff4846d04ceee854b85427
```

## Verify first

Command: `pnpm verify:first`
Exit: `0`

```text
oracles	ok	count=3727	active=21
oracle	0xe4015141c6af6265dca6bf234fd496a6614380a86e17f44a375f4e7d361da50b	status=active	asset=BTC	expiry=1781166600000
predict	0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
dbp	0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
scale	forward=62922324345536	minStrike=50000000000000	tickSize=1000000000	atmStrike=62922000000000
create_manager	ok	visibility=Public
predict_manager_abilities	{"abilities":["key"]}
devinspect_quote	ok	ask=508404	bid=488404	sender=0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a
vault_manager_gate	direct_vault_owned_blocked	PredictManager lacks store; use ManagerEscrow + fund_manager_from_idle + roll_into_strategy
```

## Address inventory

Command: `pnpm address:inventory`
Exit: `0`

```text
active	cool-dichroite	0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a
address_summary	alias	address	coin_types	sui	predict_dusdc	studio_lp	deep	dbusdc
address_summary	magical-quartz	0x38e8d7423bd38cae257f6bad3d8c449df701d88e0ef66dd33c03abdf83769212	1	0.000004	0	0	0	0
address_summary	lucid-sapphire	0x4e2e531eadcd4d3c923b449355b8d14024790d48767d33e82a4a573a046f3573	0	0	0	0	0	0
address_summary	deploy-temp	0x6d36cf792ed7f720dddb9387ca32e383d8c59e7fa164e87e7374e6e3a3c12794	0	0	0	0	0	0
address_summary	cool-dichroite	0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a	58	59.0479082	0.037513	1999.999999	0	0
address_summary	distracted-garnet	0xb2b78ad13cd3d213e5635edaf4b9bec33b1addf43b0a54cedca46e76ee0cd2a3	2	0.03517108	0	0	0	0
address_summary	mystifying-epidote	0xc13f795a75bfd490644d739473710a15b2bf5bffa670c0dd76a7d5a9dafdcc66	2	0.19800212	0	0	0	0
important_coin_objects	alias	label	count	total	coin_ids
important_coin_objects	magical-quartz	SUI	4	0.000004	0x19d80f045b59d8dbc29b4d23330e6c689b10bfe668b90c17a853dc0c8b53a3b0:1000,0x3c3c144e5346d53ec70688d879b6e7a71dac9c72146dd2404dab9424018c8826:1000,0x49ad3f789241aecdf71e47923d9bb3025cf8b101e9a98c3192fcc55142b9bb9f:1000,0x6206d2138d85e6a07db1a0f4ad4a72754b7b6b33ceebfbb6335e6ad2bcd3c9cc:1000
important_coin_objects	cool-dichroite	SUI	1	59.0479082	0x77edaf4cd5d37ca90b7b656912952204748b3802f32afa99614481e352ad74bf:59047908200
important_coin_objects	cool-dichroite	PREDICT_DUSDC	1	0.037513	0xba562dac71e6cdcc512caab16f73b87b9496db3c04544c722a3c82ac38302c95:37513
important_coin_objects	cool-dichroite	STUDIO_LP	1	1999.999999	0x54ad54bb090f231d1f48fc430381cacce0ba311072e7198d2879adee0be166ff:1999999999000
important_coin_objects	distracted-garnet	SUI	1	0.03517108	0xaddf7921184fb1d6704c877c6cb98595c0ee09a44b9cdd8ec3ddb60dc30c5c95:35171080
important_coin_objects	mystifying-epidote	SUI	1	0.19800212	0x755f1bc400c6f71d55e0c6c24f0f809707e086a31a4661984bc783c4ef29b803:198002120
important_coin_objects	mystifying-epidote	DEEP	3	0	0x2cf3f6b1a7e19923226920b1e360fda1ae15441576b48f8a5961cec16a5cf4a9:0,0x3c2ec435d56988f316264147664ad88ad0d99ac5e608f15672f6f3584d70be92:0,0x95ceff9aabeee4e9f80175914b4b39c65ec4db40fd62aad830fcdc08a7cf35fe:0
```

## DeepBook Spot check

Command: `pnpm deepbook:spot-check -- --all-addresses --dry-run`
Exit: `0`

```text
deepbook_spot_status	blocked_missing_deep
address	0x38e8d7423bd38cae257f6bad3d8c449df701d88e0ef66dd33c03abdf83769212
deep_balance	0	0 DEEP
required	500000000	500 DEEP
deep_coin_objects	0
deep_coin_types	none
checked_addresses	6
address_deep_balance	0x38e8d7423bd38cae257f6bad3d8c449df701d88e0ef66dd33c03abdf83769212	0	0 DEEP	objects=0
address_deep_balance	0x4e2e531eadcd4d3c923b449355b8d14024790d48767d33e82a4a573a046f3573	0	0 DEEP	objects=0
address_deep_balance	0x6d36cf792ed7f720dddb9387ca32e383d8c59e7fa164e87e7374e6e3a3c12794	0	0 DEEP	objects=0
address_deep_balance	0x89c2be87d2a3db2ad43f13a5b989868529c43f5d43ddad6ece3089f17df5338a	0	0 DEEP	objects=0
address_deep_balance	0xb2b78ad13cd3d213e5635edaf4b9bec33b1addf43b0a54cedca46e76ee0cd2a3	0	0 DEEP	objects=0
address_deep_balance	0xc13f795a75bfd490644d739473710a15b2bf5bffa670c0dd76a7d5a9dafdcc66	0	0 DEEP	objects=3
registry_id	0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1
deepbook_spot_package	0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c
deep_sui_quote	10 DEEP	quoted	base_out=10000000	sui_in=220400000	deep_fee=0
deep_sui_quote	50 DEEP	no_liquidity	base_out=0	sui_in=0	deep_fee=0
deep_sui_quote	500 DEEP	no_liquidity	base_out=0	sui_in=0	deep_fee=0
next	fund at least 500 DEEP before creating a DeepBook Spot secondary pool
```

## Sample settlement

Command: `pnpm settle:sample`
Exit: `0`

```text
position_already_settled	0x1fd75d34edac3d921936f0cae3d8cc4a3076cc4331742efb76b7cfd0ff499d95
```

## Vault settlement

Command: `pnpm settle:vault`
Exit: `0`

```text
vault_already_settled	0xf2124bab010e4b934089c4bfc43a8bfec1cd0f459beac3df8f9d41cb6b1cfe11
```

## K2 collateral demo

Command: `pnpm collateral:demo`
Exit: `0`

```text
K2 note-backed lending — live testnet proof

package                0x3925e59c067dbf176f6d4134427c1bd1332f5fb15c85a6df86f3465763ae0f24
note market            0x22f9ed4a57aaa281c967b3383b5377ca9ce13d5bab90e08e5260563425f5a556
  dUSDC type           0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
  LTV                  50%

create market          2XkV5RWiaGyUbxErqY1a79AZFdjH38jX6Ek66xyYgb8p
seed (withdraw)        6G4zMt9PSjAyyV5tZYq8Gwu4cw6TLgvyZtKqKxccke4c  (2 dUSDC)
mint+lock+borrow       J1tUZaHP47HZFsw4XWz5e23Sg2KRyWyXmTSbLB2kptow  (one PTB, borrowed 0.001 dUSDC)
  noteBorrow           0x53a04bdf25d830be3347097e35752de283a14faae1e700445100fb090993ab71
repay+reclaim          3Zx1QbGhrmNgheiF1xvDGFAaepbMTaCrG1hz8Kd6fZri
  reclaimed note       0xd87058d3ac7b5aa392371ad4eeb1ecdddba338a996ff4846d04ceee854b85427

Verify any digest: sui client tx-block <digest>
```

## Submission packet check

Command: `pnpm submission:check`
Exit: `0`

```text
submission_packet_ready	true
submission_packet_missing	0
```

## Hackathon readiness

Command: `pnpm hackathon:status`
Exit: `0`

```text
hackathon_ready	false
summary	pass=5	blocked=6	fail=0
gate	pass	verify:first	live Predict oracle/devInspect gate passed
gate	pass	address:inventory	active wallet has SUI and STUDIO_LP for live demo controls
gate	blocked	deepbook:spot-check	needs 500 funded DEEP for DeepBook Spot pool creation
gate	pass	settle:sample	sample settlement digest recorded or executable
gate	pass	settle:vault	vault settlement digest recorded or executable
gate	pass	collateral:demo	K2 note-backed lending loop has recorded live digests
gate	blocked	enoki:config	missing NEXT_PUBLIC_ENOKI_API_KEY, NEXT_PUBLIC_GOOGLE_CLIENT_ID, ENOKI_PRIVATE_KEY
gate	blocked	secondary-market:config	missing NEXT_PUBLIC_CETUS_STUDIO_POOL_ID or funded DeepBook Spot pool
gate	blocked	ai-intent:config	missing ANTHROPIC_API_KEY
gate	blocked	demo:video	missing DEMO_VIDEO_URL
gate	blocked	deepsurge:submission	missing DEEPSURGE_SUBMISSION_URL
```
