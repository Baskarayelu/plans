// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {FxReference} from "../src/FxReference.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {PlansFactory} from "../src/PlansFactory.sol";
import {PlansSend} from "../src/PlansSend.sol";

/// @notice Deterministic deployment of Plans through the canonical CREATE2 deployer
/// (0x4e59b44847b379578588920ca78fbf26c0b4956c, calldata = salt ++ initcode).
///
///   KeyRegistry()                                         CREATE2, KEY_REGISTRY_SALT
///   FxReference(owner, simForwarder, simTransmitter, sel)  CREATE2, FX_REFERENCE_SALT
///   PlansSend(ausd, fxReference)                          CREATE2, PLANS_SEND_SALT
///   PlansFactory(ausd, keyRegistry, fxReference)          CREATE2, PLANS_FACTORY_SALT
///     ├─ ClaimEscrow(ausd)                                CREATE from the factory, nonce 1
///     └─ Pot(ausd, keyRegistry, escrow, fxReference)      CREATE from the factory, nonce 2 (the clone implementation)
///
/// Addresses depend only on the salts, the compiled bytecode, the AUSD address and FxReference's
/// constructor arguments, never on the sender. A contract whose predicted address already has code
/// is skipped, so the script can be re-run safely. AUSD, the CRE simulation forwarder
/// (MockKeystoneForwarder) and the CCIP chain selector are chosen by chain id (143 mainnet, 10143
/// testnet). FxReference's owner and simulation transmitter come from the environment:
/// `FX_OWNER` (required) and `FX_SIM_TRANSMITTER` (defaults to `FX_OWNER`; the wallet that runs
/// `cre workflow simulate --broadcast`). On a local chain (31337) set `AUSD=<address>`, and
/// optionally `FX_SIM_FORWARDER` (default: the testnet mock's address).
///
/// `forge script` must run with `--disable-code-size-limit`: the Pot runtime is ~29 KB, above
/// EIP-170's 24 KB but well under Monad's 128 KB limit.
///
/// On Monad this script is a DRY RUN ONLY: it says WHAT to deploy, and forge writes the
/// transactions to `broadcast/Deploy.s.sol/<chainid>/dry-run/run-latest.json`. `script/monad-send.mjs`
/// then sends them with gas limits from Monad's own `eth_estimateGas`. forge's broadcast would set
/// each gas limit from its local Ethereum-priced simulation, and Monad charges the full limit and
/// prices cold state differently (see GAS.md), so `--broadcast` reverts with BroadcastNotAllowed
/// unless the RPC is a local anvil node (a rehearsal, which writes `deployments/<chainid>-anvil.json`).
contract Deploy is Script {
    address public constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    address public constant AUSD_MAINNET = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;
    address public constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    bytes32 public constant KEY_REGISTRY_SALT = keccak256("plans.v1.KeyRegistry");
    bytes32 public constant PLANS_SEND_SALT = keccak256("plans.v1.PlansSend");
    bytes32 public constant PLANS_FACTORY_SALT = keccak256("plans.v1.PlansFactory");
    bytes32 public constant FX_REFERENCE_SALT = keccak256("plans.v1.FxReference");

    /// @notice Chainlink CRE MockKeystoneForwarder ("simulation forwarder") per Monad network.
    address public constant SIM_FORWARDER_MAINNET = 0x9eF6468C5f37b976E57d52054c693269479A784d;
    address public constant SIM_FORWARDER_TESTNET = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    /// @notice CCIP chain selectors (smartcontractkit/chain-selectors).
    uint64 public constant CHAIN_SELECTOR_MAINNET = 8481857512324358265;
    uint64 public constant CHAIN_SELECTOR_TESTNET = 2183018362218727504;
    /// @notice Local chain (31337) selector, only for tests and rehearsals.
    uint64 public constant CHAIN_SELECTOR_LOCAL = 31337;

    /// @notice FxReference constructor arguments.
    struct FxConfig {
        address owner;
        address simForwarder;
        address simTransmitter;
        uint64 chainSelector;
    }

    struct Deployment {
        uint256 chainId;
        address ausd;
        address keyRegistry;
        address fxReference;
        address plansSend;
        address plansFactory;
        address claimEscrow;
        address potImplementation;
    }

    error UnsupportedChain(uint256 chainId);
    error NoAUSD(address ausd);
    error NoCreate2Deployer();
    error Create2Failed(bytes32 salt);
    error UnexpectedAddress(address expected, address actual);
    /// @notice `forge script --broadcast` against a non-anvil RPC: use script/monad-send.mjs instead.
    error BroadcastNotAllowed();

    function run() external returns (Deployment memory d) {
        bool broadcasting =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (broadcasting && !_isAnvil()) revert BroadcastNotAllowed();
        address ausd = ausdFor(block.chainid);
        if (ausd.code.length == 0) revert NoAUSD(ausd);
        FxConfig memory fx = fxConfigFor(block.chainid);

        vm.startBroadcast();
        d = deploy(ausd, fx);
        vm.stopBroadcast();

        _log(d);
        _logFx(fx);
        if (broadcasting) {
            write(d, _outputPath());
        } else {
            console.log("Dry run: nothing sent. Send with: node script/monad-send.mjs check|send --chain", block.chainid);
        }
    }

    /// @notice AUSD for `chainId`: fixed on Monad mainnet and testnet, `AUSD` env var on anvil.
    function ausdFor(uint256 chainId) public view returns (address) {
        if (chainId == 143) return AUSD_MAINNET;
        if (chainId == 10143) return AUSD_TESTNET;
        if (chainId == 31337) return vm.envAddress("AUSD");
        revert UnsupportedChain(chainId);
    }

    /// @notice FxReference's constructor arguments for `chainId`: the simulation forwarder and
    /// chain selector are fixed per Monad network; owner and transmitter come from `FX_OWNER` and
    /// `FX_SIM_TRANSMITTER` (default `FX_OWNER`).
    function fxConfigFor(uint256 chainId) public view returns (FxConfig memory c) {
        if (chainId == 143) {
            c.simForwarder = SIM_FORWARDER_MAINNET;
            c.chainSelector = CHAIN_SELECTOR_MAINNET;
        } else if (chainId == 10143) {
            c.simForwarder = SIM_FORWARDER_TESTNET;
            c.chainSelector = CHAIN_SELECTOR_TESTNET;
        } else if (chainId == 31337) {
            c.simForwarder = vm.envOr("FX_SIM_FORWARDER", SIM_FORWARDER_TESTNET);
            c.chainSelector = CHAIN_SELECTOR_LOCAL;
        } else {
            revert UnsupportedChain(chainId);
        }
        c.owner = vm.envAddress("FX_OWNER");
        c.simTransmitter = vm.envOr("FX_SIM_TRANSMITTER", c.owner);
    }

    /// @notice The addresses `deploy(ausd, fx)` produces on the current chain.
    function predict(address ausd, FxConfig memory fx) public view returns (Deployment memory d) {
        d.chainId = block.chainid;
        d.ausd = ausd;
        d.keyRegistry = _predict(KEY_REGISTRY_SALT, keyRegistryInitCode());
        d.fxReference = _predict(FX_REFERENCE_SALT, fxReferenceInitCode(fx));
        d.plansSend = _predict(PLANS_SEND_SALT, plansSendInitCode(ausd, d.fxReference));
        d.plansFactory = _predict(PLANS_FACTORY_SALT, plansFactoryInitCode(ausd, d.keyRegistry, d.fxReference));
        d.claimEscrow = vm.computeCreateAddress(d.plansFactory, 1);
        d.potImplementation = vm.computeCreateAddress(d.plansFactory, 2);
    }

    /// @notice Deploys whatever is missing. Every call goes to the CREATE2 deployer, so inside a
    /// broadcast each deployment is one transaction from the broadcaster.
    function deploy(address ausd, FxConfig memory fx) public returns (Deployment memory d) {
        if (CREATE2_DEPLOYER.code.length == 0) revert NoCreate2Deployer();
        d.chainId = block.chainid;
        d.ausd = ausd;
        d.keyRegistry = _deploy("KeyRegistry", KEY_REGISTRY_SALT, keyRegistryInitCode());
        d.fxReference = _deploy("FxReference", FX_REFERENCE_SALT, fxReferenceInitCode(fx));
        d.plansSend = _deploy("PlansSend", PLANS_SEND_SALT, plansSendInitCode(ausd, d.fxReference));
        d.plansFactory = _deploy(
            "PlansFactory", PLANS_FACTORY_SALT, plansFactoryInitCode(ausd, d.keyRegistry, d.fxReference)
        );
        PlansFactory factory = PlansFactory(d.plansFactory);
        d.claimEscrow = factory.claimEscrow();
        d.potImplementation = factory.potImplementation();
        _expect(vm.computeCreateAddress(d.plansFactory, 1), d.claimEscrow);
        _expect(vm.computeCreateAddress(d.plansFactory, 2), d.potImplementation);
        _expect(d.fxReference, factory.fxReference());
    }

    function keyRegistryInitCode() public pure returns (bytes memory) {
        return type(KeyRegistry).creationCode;
    }

    function fxReferenceInitCode(FxConfig memory fx) public pure returns (bytes memory) {
        return abi.encodePacked(
            type(FxReference).creationCode, abi.encode(fx.owner, fx.simForwarder, fx.simTransmitter, fx.chainSelector)
        );
    }

    function plansSendInitCode(address ausd, address fxReference) public pure returns (bytes memory) {
        return abi.encodePacked(type(PlansSend).creationCode, abi.encode(ausd, fxReference));
    }

    function plansFactoryInitCode(address ausd, address keyRegistry, address fxReference)
        public
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(type(PlansFactory).creationCode, abi.encode(ausd, keyRegistry, fxReference));
    }

    /// @notice Writes `d`, the CREATE2 deployer and the salts to `path` as JSON.
    function write(Deployment memory d, string memory path) public {
        string memory salts = "salts";
        vm.serializeBytes32(salts, "keyRegistry", KEY_REGISTRY_SALT);
        vm.serializeBytes32(salts, "plansSend", PLANS_SEND_SALT);
        vm.serializeBytes32(salts, "fxReference", FX_REFERENCE_SALT);
        salts = vm.serializeBytes32(salts, "plansFactory", PLANS_FACTORY_SALT);

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", d.chainId);
        vm.serializeAddress(o, "ausd", d.ausd);
        vm.serializeAddress(o, "keyRegistry", d.keyRegistry);
        vm.serializeAddress(o, "fxReference", d.fxReference);
        vm.serializeAddress(o, "plansSend", d.plansSend);
        vm.serializeAddress(o, "plansFactory", d.plansFactory);
        vm.serializeAddress(o, "claimEscrow", d.claimEscrow);
        vm.serializeAddress(o, "potImplementation", d.potImplementation);
        vm.serializeAddress(o, "create2Deployer", CREATE2_DEPLOYER);
        string memory json = vm.serializeString(o, "salts", salts);

        vm.createDir(string.concat(vm.projectRoot(), "/deployments"), true);
        vm.writeJson(json, path);
        console.log("Wrote", path);
    }

    function _outputPath() internal returns (string memory) {
        string memory name = vm.toString(block.chainid);
        if (_isAnvil()) name = string.concat(name, "-anvil");
        return string.concat(vm.projectRoot(), "/deployments/", name, ".json");
    }

    /// @dev True when the script's RPC is a local anvil node.
    function _isAnvil() internal returns (bool) {
        try vm.rpc("web3_clientVersion", "[]") returns (bytes memory version) {
            return vm.indexOf(string(version), "anvil") != type(uint256).max;
        } catch {
            return false;
        }
    }

    function _predict(bytes32 salt, bytes memory initCode) internal pure returns (address) {
        return vm.computeCreate2Address(salt, keccak256(initCode), CREATE2_DEPLOYER);
    }

    function _deploy(string memory name, bytes32 salt, bytes memory initCode) internal returns (address addr) {
        address predicted = _predict(salt, initCode);
        if (predicted.code.length != 0) {
            console.log(string.concat(name, ": already deployed at"), predicted);
            return predicted;
        }
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        if (!ok || ret.length != 20) revert Create2Failed(salt);
        addr = address(bytes20(ret));
        _expect(predicted, addr);
        console.log(string.concat(name, ": deployed at"), addr);
    }

    function _expect(address expected, address actual) internal pure {
        if (expected != actual) revert UnexpectedAddress(expected, actual);
    }

    function _log(Deployment memory d) internal pure {
        console.log("chainId          ", d.chainId);
        console.log("ausd             ", d.ausd);
        console.log("keyRegistry      ", d.keyRegistry);
        console.log("fxReference      ", d.fxReference);
        console.log("plansSend        ", d.plansSend);
        console.log("plansFactory     ", d.plansFactory);
        console.log("claimEscrow      ", d.claimEscrow);
        console.log("potImplementation", d.potImplementation);
    }

    function _logFx(FxConfig memory fx) internal pure {
        console.log("fx owner         ", fx.owner);
        console.log("fx simForwarder  ", fx.simForwarder);
        console.log("fx simTransmitter", fx.simTransmitter);
        console.log("fx chainSelector ", fx.chainSelector);
    }
}
