{
  description = "Automatically redeem Codex rate-limit reset credits";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      homeManagerModules.default = import ./nix/home-manager.nix;
      homeManagerModules.codex-limit-auto-reset = self.homeManagerModules.default;

      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        rec {
          codex-limit-auto-reset = pkgs.callPackage ./nix/package.nix { };
          default = codex-limit-auto-reset;
        }
      );
      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/codex-limit-auto-reset";
          meta.description = "Run the automatic credit-redemption worker";
        };
        credits = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/codex-limit-auto-reset-cli";
          meta.description = "List available reset credits";
        };
      });
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs
              pkgs.pnpm_11
            ];
          };
        }
      );
      checks = forAllSystems (system: {
        package = self.packages.${system}.default;
      });
    };
}
