// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ClaimEscrow} from "../src/ClaimEscrow.sol";
import {KeyRegistry} from "../src/KeyRegistry.sol";
import {PlansFactory} from "../src/PlansFactory.sol";
import {PlansSend} from "../src/PlansSend.sol";
import {Pot} from "../src/Pot.sol";
import {IPlansTypes} from "../src/interfaces/IPlansTypes.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice Runs script/Deploy.s.sol's logic: locally with the CREATE2 deployer etched, and on a
/// Monad mainnet fork (skipped when the RPC is unreachable or SKIP_FORK_TESTS is set).
contract DeployTest is Test {
    /// @dev Runtime code of the deterministic deployer at 0x4e59b44847b379578588920ca78fbf26c0b4956c.
    bytes internal constant CREATE2_DEPLOYER_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function _etchDeployer() internal {
        vm.etch(script.CREATE2_DEPLOYER(), CREATE2_DEPLOYER_CODE);
    }

    function _assertDeployment(Deploy.Deployment memory d, address ausd) internal view {
        Deploy.Deployment memory p = script.predict(ausd);
        assertEq(d.chainId, block.chainid, "chainId");
        assertEq(d.ausd, ausd, "ausd");
        assertEq(d.keyRegistry, p.keyRegistry, "keyRegistry address");
        assertEq(d.plansSend, p.plansSend, "plansSend address");
        assertEq(d.plansFactory, p.plansFactory, "plansFactory address");
        assertEq(d.claimEscrow, p.claimEscrow, "claimEscrow address");
        assertEq(d.potImplementation, p.potImplementation, "potImplementation address");

        // CREATE2 through the canonical deployer, independent of the sender.
        assertEq(
            d.keyRegistry,
            vm.computeCreate2Address(
                script.KEY_REGISTRY_SALT(), keccak256(type(KeyRegistry).creationCode), script.CREATE2_DEPLOYER()
            )
        );

        // Wiring.
        PlansFactory factory = PlansFactory(d.plansFactory);
        assertEq(factory.ausd(), ausd);
        assertEq(factory.keyRegistry(), d.keyRegistry);
        assertEq(factory.claimEscrow(), d.claimEscrow);
        assertEq(factory.potImplementation(), d.potImplementation);
        assertEq(d.claimEscrow, vm.computeCreateAddress(d.plansFactory, 1), "escrow = factory CREATE nonce 1");
        assertEq(d.potImplementation, vm.computeCreateAddress(d.plansFactory, 2), "pot impl = factory CREATE nonce 2");

        ClaimEscrow escrow = ClaimEscrow(d.claimEscrow);
        assertEq(escrow.factory(), d.plansFactory);
        assertEq(escrow.ausd(), ausd);

        Pot impl = Pot(d.potImplementation);
        assertEq(impl.factory(), d.plansFactory);
        assertEq(impl.ausd(), ausd);
        assertEq(address(impl.keyRegistry()), d.keyRegistry);
        assertEq(address(impl.claimEscrow()), d.claimEscrow);
        assertGt(d.potImplementation.code.length, 24_576, "Pot runtime is above EIP-170");

        assertEq(PlansSend(d.plansSend).ausd(), ausd);
        assertGt(d.keyRegistry.code.length, 0);
    }

    function test_deploy_local() public {
        _etchDeployer();
        address ausd = address(new MockAUSD());

        Deploy.Deployment memory d = script.deploy(ausd);
        _assertDeployment(d, ausd);

        // The implementation can never be initialised: it is marked initialised and only the
        // factory may call initialize.
        IPlansTypes.CreatePotParams memory params;
        vm.prank(d.plansFactory);
        vm.expectRevert(Pot.AlreadyInitialized.selector);
        Pot(d.potImplementation).initialize(address(this), params);
    }

    function test_deploy_isIdempotent() public {
        _etchDeployer();
        address ausd = address(new MockAUSD());
        Deploy.Deployment memory first = script.deploy(ausd);
        Deploy.Deployment memory second = script.deploy(ausd);
        assertEq(abi.encode(first), abi.encode(second));
        _assertDeployment(second, ausd);
    }

    function test_deploy_addressesDoNotDependOnSender() public {
        _etchDeployer();
        address ausd = address(new MockAUSD());
        Deploy.Deployment memory expected = script.predict(ausd);
        Deploy other = new Deploy();
        vm.prank(makeAddr("someone else"));
        Deploy.Deployment memory d = other.deploy(ausd);
        assertEq(abi.encode(d), abi.encode(expected));
    }

    function test_deploy_revertsWithoutCreate2Deployer() public {
        vm.etch(script.CREATE2_DEPLOYER(), "");
        address ausd = address(new MockAUSD());
        vm.expectRevert(Deploy.NoCreate2Deployer.selector);
        script.deploy(ausd);
    }

    function test_ausdFor() public {
        assertEq(script.ausdFor(143), 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
        assertEq(script.ausdFor(10143), 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.setEnv("AUSD", vm.toString(address(0xA05D)));
        assertEq(script.ausdFor(31337), address(0xA05D));
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        script.ausdFor(1);
    }

    /// @notice The full `run()` on a local chain (chain 31337, AUSD from the env).
    function test_run_local() public {
        _etchDeployer();
        address ausd = address(new MockAUSD());
        vm.chainId(31337);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.setEnv("AUSD", vm.toString(ausd));
        Deploy.Deployment memory d = script.run();
        _assertDeployment(d, ausd);
    }

    /// @notice `run()` against a Monad mainnet fork, with the real CREATE2 deployer and AUSD.
    function test_run_monadFork() public {
        if (vm.envOr("SKIP_FORK_TESTS", false)) vm.skip(true, "SKIP_FORK_TESTS is set");
        try vm.createSelectFork("monad") returns (uint256) {}
        catch {
            vm.skip(true, "RPC unreachable: monad");
        }
        assertEq(block.chainid, 143);
        script = new Deploy(); // the one from setUp does not exist on the fork
        assertEq(keccak256(script.CREATE2_DEPLOYER().code), keccak256(CREATE2_DEPLOYER_CODE), "CREATE2 deployer");

        address ausd = script.AUSD_MAINNET();
        Deploy.Deployment memory d = script.run();
        _assertDeployment(d, ausd);
    }
}
