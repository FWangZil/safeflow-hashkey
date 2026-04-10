// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SafeFlowVault} from "../src/SafeFlowVault.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        SafeFlowVault vault = new SafeFlowVault();
        console2.log("SafeFlowVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
