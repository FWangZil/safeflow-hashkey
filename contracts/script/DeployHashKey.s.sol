// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SafeFlowVaultHashKey} from "../src/SafeFlowVaultHashKey.sol";

contract DeployHashKeyScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        SafeFlowVaultHashKey vault = new SafeFlowVaultHashKey();
        console2.log("SafeFlowVaultHashKey deployed at:", address(vault));

        vm.stopBroadcast();
    }
}
