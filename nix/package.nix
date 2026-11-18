{
  lib,
  stdenv,
  fetchPnpmDeps,
  makeWrapper,
  nodejs,
  pnpm_11,
  pnpmConfigHook,
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "codex-limit-auto-reset";
  version = "0.1.0";

  src = lib.cleanSource ../.;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_11;
    hash = "sha256-ruxSIyrzCpnM5ZqhjN2Ei+0W8NWTbUqKdbfLbZFke3M=";
    fetcherVersion = 4;
  };

  nativeBuildInputs = [
    nodejs
    pnpm_11
    pnpmConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    pnpm prune --prod --ignore-scripts
    mkdir -p $out/lib/${finalAttrs.pname}
    cp -r dist node_modules package.json $out/lib/${finalAttrs.pname}/
    find $out/lib/${finalAttrs.pname}/node_modules -xtype l -delete

    makeWrapper ${nodejs}/bin/node $out/bin/codex-limit-auto-reset \
      --add-flags $out/lib/${finalAttrs.pname}/dist/main.js
    makeWrapper ${nodejs}/bin/node $out/bin/codex-limit-auto-reset-cli \
      --add-flags $out/lib/${finalAttrs.pname}/dist/cli.js

    runHook postInstall
  '';

  meta = {
    description = "Automatically redeem Codex rate-limit reset credits before they expire";
    homepage = "https://github.com/fa0311/codex-limit-auto-reset";
    license = lib.licenses.mit;
    mainProgram = "codex-limit-auto-reset";
    inherit (nodejs.meta) platforms;
  };
})
