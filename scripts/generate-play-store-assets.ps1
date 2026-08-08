$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$assetsDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\play-store-assets"))
[System.IO.Directory]::CreateDirectory($assetsDirectory) | Out-Null

$dark = [System.Drawing.ColorTranslator]::FromHtml("#0B0F0D")
$lime = [System.Drawing.ColorTranslator]::FromHtml("#D7FF3F")
$amber = [System.Drawing.ColorTranslator]::FromHtml("#FFC857")
$white = [System.Drawing.ColorTranslator]::FromHtml("#F7F9F7")
$muted = [System.Drawing.ColorTranslator]::FromHtml("#9AA69F")

function New-RoundedRectanglePath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Set-HighQualityGraphics {
  param([System.Drawing.Graphics]$Graphics)

  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
}

function Draw-BrandMark {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.RectangleF]$Rectangle,
    [float]$CornerRadius,
    [float]$LetterSize,
    [float]$DotSize
  )

  $markPath = New-RoundedRectanglePath -Rectangle $Rectangle -Radius $CornerRadius
  $limeBrush = [System.Drawing.SolidBrush]::new($lime)
  $Graphics.FillPath($limeBrush, $markPath)

  $font = [System.Drawing.Font]::new("Arial", $LetterSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new($dark)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $Graphics.DrawString("B", $font, $textBrush, $Rectangle, $format)

  $dotBorder = [System.Drawing.SolidBrush]::new($dark)
  $dotBrush = [System.Drawing.SolidBrush]::new($amber)
  $dotX = $Rectangle.Right - ($DotSize * 0.72)
  $dotY = $Rectangle.Top - ($DotSize * 0.28)
  $Graphics.FillEllipse($dotBorder, $dotX - 5, $dotY - 5, $DotSize + 10, $DotSize + 10)
  $Graphics.FillEllipse($dotBrush, $dotX, $dotY, $DotSize, $DotSize)

  $markPath.Dispose()
  $limeBrush.Dispose()
  $font.Dispose()
  $textBrush.Dispose()
  $format.Dispose()
  $dotBorder.Dispose()
  $dotBrush.Dispose()
}

$icon = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$iconGraphics = [System.Drawing.Graphics]::FromImage($icon)
Set-HighQualityGraphics -Graphics $iconGraphics
$iconGraphics.Clear($dark)
Draw-BrandMark -Graphics $iconGraphics -Rectangle ([System.Drawing.RectangleF]::new(68, 68, 376, 376)) -CornerRadius 88 -LetterSize 238 -DotSize 48
$iconPath = Join-Path $assetsDirectory "developer-icon-512.png"
$icon.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
$iconGraphics.Dispose()
$icon.Dispose()

$header = [System.Drawing.Bitmap]::new(4096, 2304, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$headerGraphics = [System.Drawing.Graphics]::FromImage($header)
Set-HighQualityGraphics -Graphics $headerGraphics
$headerGraphics.Clear($dark)

$gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(24, 215, 255, 63), 2)
for ($x = 0; $x -le 4096; $x += 192) { $headerGraphics.DrawLine($gridPen, $x, 0, $x, 2304) }
for ($y = 0; $y -le 2304; $y += 192) { $headerGraphics.DrawLine($gridPen, 0, $y, 4096, $y) }
$gridPen.Dispose()

$glowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(18, 215, 255, 63))
$headerGraphics.FillEllipse($glowBrush, -420, 820, 2000, 2000)
$glowBrush.Dispose()

Draw-BrandMark -Graphics $headerGraphics -Rectangle ([System.Drawing.RectangleF]::new(380, 702, 900, 900)) -CornerRadius 210 -LetterSize 570 -DotSize 112

$brandFont = [System.Drawing.Font]::new("Arial", 260, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$proMaxFont = [System.Drawing.Font]::new("Arial", 205, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$taglineFont = [System.Drawing.Font]::new("Arial", 72, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$whiteBrush = [System.Drawing.SolidBrush]::new($white)
$limeBrush = [System.Drawing.SolidBrush]::new($lime)
$mutedBrush = [System.Drawing.SolidBrush]::new($muted)

$headerGraphics.DrawString("BINGO", $brandFont, $whiteBrush, 1530, 710)
$headerGraphics.DrawString("PROMAX", $proMaxFont, $limeBrush, 1540, 1020)
$headerGraphics.DrawString("CONTROL PROFESIONAL DE PARTIDAS", $taglineFont, $mutedBrush, 1550, 1360)

$accentPen = [System.Drawing.Pen]::new($amber, 18)
$headerGraphics.DrawLine($accentPen, 1550, 1505, 2490, 1505)
$accentPen.Dispose()

$headerPath = Join-Path $assetsDirectory "developer-header-4096x2304.png"
$header.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Png)

$brandFont.Dispose()
$proMaxFont.Dispose()
$taglineFont.Dispose()
$whiteBrush.Dispose()
$limeBrush.Dispose()
$mutedBrush.Dispose()
$headerGraphics.Dispose()
$header.Dispose()

Get-Item $iconPath, $headerPath | Select-Object FullName, Length
