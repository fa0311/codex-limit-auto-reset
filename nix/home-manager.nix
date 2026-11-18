{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.codex-limit-auto-reset;
in
{
  options.services.codex-limit-auto-reset = {
    enable = lib.mkEnableOption "automatic redemption of Codex rate-limit reset credits";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./package.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./package.nix { }";
      description = "The codex-limit-auto-reset package to use.";
    };

    codexHome = lib.mkOption {
      type = lib.types.str;
      default = config.home.sessionVariables.CODEX_HOME or "${config.home.homeDirectory}/.codex";
      defaultText = lib.literalExpression ''config.home.sessionVariables.CODEX_HOME or (config.home.homeDirectory + "/.codex")'';
      description = "Directory containing the user's Codex authentication.";
    };

    codexPackage = lib.mkOption {
      type = lib.types.package;
      default = if config.programs.codex.enable then config.programs.codex.package else pkgs.codex;
      defaultText = lib.literalExpression "if config.programs.codex.enable then config.programs.codex.package else pkgs.codex";
      description = "The Codex CLI package used to redeem credits.";
    };

    redeemBeforeMinutes = lib.mkOption {
      type = lib.types.ints.positive;
      default = 360;
      description = "Redeem credits this many minutes before expiration.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.codex-limit-auto-reset = {
      Unit.Description = "Codex Limit Auto Reset";
      Install.WantedBy = [ "default.target" ];
      Service = {
        ExecStart = lib.getExe cfg.package;
        Environment = [
          "CODEX_BIN=${lib.getExe cfg.codexPackage}"
          "CODEX_HOME=${cfg.codexHome}"
          "REDEEM_BEFORE_MINUTES=${toString cfg.redeemBeforeMinutes}"
        ];
        Restart = "on-failure";
        RestartSec = "10s";
      };
    };
  };
}
