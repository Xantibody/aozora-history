{
  description = "Firefox extension (desktop & Android) dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      # NOTE: url and hash are auto-updated by .github/workflows/update-flake-amo.yml
      # (empty until the first release is published on AMO)
      amoUrl = "";
      amoHash = "";
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          name = "aozora-history-firefox-xpi";

          src = pkgs.fetchurl {
            url = amoUrl;
            hash = amoHash;
          };

          passthru.addonId = "aozora-history@example.com";

          preferLocalBuild = true;
          allowSubstitutes = true;

          buildCommand = ''
            dst="$out/share/mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
            mkdir -p "$dst"
            install -v -m644 "$src" "$dst/aozora-history@example.com.xpi"
          '';
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
            typescript-go
            oxfmt
            oxlint
          ];
        };
      }
    );
}
