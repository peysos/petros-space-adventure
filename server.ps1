$port=8000
$root='C:\Users\pkepe\OneDrive\Desktop\vc3'
$listener=New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving at http://localhost:$port" -ForegroundColor Green
while($listener.IsListening){
  $ctx=$listener.GetContext()
  $req=$ctx.Request
  $res=$ctx.Response
  try{
    $rel=$req.Url.AbsolutePath.TrimStart('/')
    if([string]::IsNullOrEmpty($rel)){$rel='index.html'}
    $path=Join-Path $root $rel
    if(-not (Test-Path -LiteralPath $path -PathType Leaf)){$res.StatusCode=404;$res.Close();continue}
    $bytes=[System.IO.File]::ReadAllBytes($path)
    $ext=[System.IO.Path]::GetExtension($path).ToLower()
    $mime='application/octet-stream'
    if($ext -eq '.html'){$mime='text/html'}
    elseif($ext -eq '.css'){$mime='text/css'}
    elseif($ext -eq '.js'){$mime='application/javascript'}
    elseif($ext -eq '.png'){$mime='image/png'}
    elseif($ext -eq '.jpg'){$mime='image/jpeg'}
    elseif($ext -eq '.svg'){$mime='image/svg+xml'}
    elseif($ext -eq '.json'){$mime='application/json'}
    elseif($ext -eq '.ico'){$mime='image/x-icon'}
    $res.ContentType=$mime
    $res.ContentLength64=$bytes.Length
    $res.OutputStream.Write($bytes,0,$bytes.Length)
  }catch{$res.StatusCode=500}
  finally{$res.Close()}
}