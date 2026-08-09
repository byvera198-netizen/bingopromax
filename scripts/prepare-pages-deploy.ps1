$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$clientBuild = Join-Path $projectRoot "dist\client"
$serverBuild = Join-Path $projectRoot "dist\server"
$stagingPath = Join-Path $projectRoot "dist-pages"
$esbuild = Join-Path $projectRoot "node_modules\.bin\esbuild.cmd"

if (-not (Test-Path -LiteralPath $clientBuild) -or -not (Test-Path -LiteralPath $serverBuild)) {
  throw "No se encontró la compilación. Ejecuta npm run build antes de preparar Cloudflare Pages."
}

if (Test-Path -LiteralPath $stagingPath) {
  $resolvedStaging = (Resolve-Path -LiteralPath $stagingPath).Path
  if (-not $resolvedStaging.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "La carpeta temporal está fuera del proyecto."
  }
  Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingPath | Out-Null
Get-ChildItem -Force -LiteralPath $clientBuild | Copy-Item -Destination $stagingPath -Recurse -Force
[System.IO.File]::WriteAllText(
  (Join-Path $stagingPath ".assetsignore"),
  "_worker.js`nwrangler.json`n.dev.vars`n",
  [System.Text.UTF8Encoding]::new($false)
)

if (-not (Test-Path -LiteralPath $esbuild)) {
  throw "No se encontró el empaquetador de JavaScript del proyecto."
}

& $esbuild `
  (Join-Path $serverBuild "index.js") `
  --bundle `
  --format=esm `
  --platform=node `
  --target=es2022 `
  --minify `
  "--external:cloudflare:workers" `
  "--external:/pdfjs/*" `
  "--outfile=$(Join-Path $stagingPath '_worker.js')"

if ($LASTEXITCODE -ne 0) {
  throw "No se pudo preparar el servidor de Cloudflare Pages."
}

$workerPath = Join-Path $stagingPath "_worker.js"
$workerSource = [System.IO.File]::ReadAllText($workerPath)
foreach ($nodeModule in @("fs", "http", "https", "path", "punycode", "stream", "url", "util", "worker_threads", "zlib")) {
  $workerSource = $workerSource.Replace("from`"$nodeModule`"", "from`"node:$nodeModule`"")
  $workerSource = $workerSource.Replace("from'$nodeModule'", "from'node:$nodeModule'")
}
$workerSource = $workerSource.Replace(
  'import("/pdfjs/pdf.mjs")',
  'Promise.reject(new Error("La importación PDF solo está disponible en el navegador."))'
)
$defaultExport = [regex]::Match($workerSource, 'export\{([A-Za-z_$][A-Za-z0-9_$]*) as default\};')
if (-not $defaultExport.Success) {
  throw "No se encontro la exportacion principal del servidor."
}

$serverHandler = $defaultExport.Groups[1].Value
$pagesHandler = 'var pagesStaticHandler={async fetch(e,t,r){let u=new URL(e.url);if(e.method!=="GET"&&e.method!=="HEAD"||u.pathname.startsWith("/api/"))return ' + $serverHandler + '.fetch(e,t,r);if(t&&t.ASSETS){let s=await t.ASSETS.fetch(e);if(s.status!==404)return s}return ' + $serverHandler + '.fetch(e,t,r)}};export{pagesStaticHandler as default};'
$workerSource = $workerSource.Remove($defaultExport.Index, $defaultExport.Length).Insert($defaultExport.Index, $pagesHandler)
[System.IO.File]::WriteAllText($workerPath, $workerSource, [System.Text.UTF8Encoding]::new($false))

$requiredFiles = @(
  (Join-Path $stagingPath "_worker.js")
)

foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Falta un archivo necesario para publicar: $requiredFile"
  }
}

if (-not (Get-ChildItem -File -LiteralPath (Join-Path $stagingPath "assets") -Filter "game-console-*.js" | Select-Object -First 1)) {
  throw "No se encontraron los archivos interactivos de la aplicación."
}

$assetCount = (Get-ChildItem -Recurse -File -LiteralPath $stagingPath).Count
Write-Output "Paquete de Cloudflare Pages preparado correctamente ($assetCount archivos)."
