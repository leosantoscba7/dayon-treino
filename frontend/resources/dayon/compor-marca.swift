// DAYON - Treino: compõe o ícone, as telas de abertura e os ícones do PWA/site.
//
// Bases de imagem (geradas no Higgsfield, SEM nenhum texto; ver design-ref/higgsfield-raw/LEIA-ME.txt):
//   design-ref/higgsfield-raw/icon-base.png    squircle verde lima→folha: dá o degradê do ícone
//   design-ref/higgsfield-raw/splash-base.png  fundo branco com brilho lima sutil
// Todo texto ("DAY" e "ON") e a pílula verde do "ON" são desenhados AQUI, por código: a IA nunca
// escreveu texto nas imagens, e a pílula da IA (pill-base.png) veio com alpha sujo e não é usada.
//
// Uso (na pasta frontend/):  swift resources/dayon/compor-marca.swift
import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let fm = FileManager.default
let FRONT = fm.currentDirectoryPath
let ROOT = (FRONT as NSString).deletingLastPathComponent
let RAW = ROOT + "/design-ref/higgsfield-raw"

// Cores da marca (as das referências design-ref/ref-inicio.png e ref-calorias.png)
let LIMA = CGColor(srgbRed: 0.659, green: 0.937, blue: 0.239, alpha: 1)   // #a8ef3d
let FOLHA = CGColor(srgbRed: 0.188, green: 0.639, blue: 0.137, alpha: 1)  // #30a323
let TINTA = CGColor(srgbRed: 0.071, green: 0.071, blue: 0.078, alpha: 1)  // #121214, o "DAY"
let BRANCO = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)

func loadImage(_ path: String) -> CGImage {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("não abriu \(path)") }
  return img
}

func context(_ w: Int, _ h: Int, alpha: Bool) -> CGContext {
  let info = alpha ? CGImageAlphaInfo.premultipliedLast.rawValue : CGImageAlphaInfo.noneSkipLast.rawValue
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: info)!
  ctx.interpolationQuality = .high
  ctx.setShouldAntialias(true)
  return ctx
}

func writePNG(_ ctx: CGContext, _ rel: String, opaque: Bool = true) {
  var img = ctx.makeImage()!
  if opaque {
    // Sem canal alfa (a Apple recusa ícone com alfa).
    let c = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 3 + (4 - (img.width * 3) % 4) % 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.none.rawValue)
    if let c = c { c.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height)); img = c.makeImage()! }
  }
  let url = URL(fileURLWithPath: rel.hasPrefix("/") ? rel : FRONT + "/" + rel)
  try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

func pngSize(_ rel: String) -> (Int, Int)? {
  let url = URL(fileURLWithPath: FRONT + "/" + rel)
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
        let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int else { return nil }
  return (w, h)
}

// ---------------------------------------------------------------- ícone
// O degradê vem do squircle do Higgsfield: o miolo dele (sem bordas nem sombra) esticado até as
// bordas, porque o iOS e o Android aplicam a máscara do ícone eles mesmos.
let iconBase = loadImage(RAW + "/icon-base.png")
let gradCrop = iconBase.cropping(to: CGRect(x: 880, y: 340, width: 288, height: 1370))!

/// O símbolo de "ligar" (o "O" do "ON" no logo), branco, centrado em (cx, cy) com raio r.
func power(_ ctx: CGContext, cx: CGFloat, cy: CGFloat, r: CGFloat, stroke: CGFloat, color: CGColor) {
  ctx.saveGState()
  ctx.setStrokeColor(color)
  ctx.setLineWidth(stroke)
  ctx.setLineCap(.round)
  // Coordenadas do CoreGraphics: y para cima. A abertura do arco fica em cima (90°).
  let gap: CGFloat = .pi / 180 * 40
  ctx.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: .pi / 2 + gap, endAngle: .pi / 2 - gap + 2 * .pi, clockwise: false)
  ctx.strokePath()
  ctx.move(to: CGPoint(x: cx, y: cy + r * 1.08))
  ctx.addLine(to: CGPoint(x: cx, y: cy + r * 0.12))
  ctx.strokePath()
  ctx.restoreGState()
}

func drawIcon(size: Int, round: Bool = false) -> CGContext {
  let ctx = context(size, size, alpha: round)
  let s = CGFloat(size)
  if round {
    ctx.addEllipse(in: CGRect(x: 0, y: 0, width: s, height: s))
    ctx.clip()
  }
  ctx.draw(gradCrop, in: CGRect(x: 0, y: 0, width: s, height: s))
  // Sombra suave sob o símbolo, como os elementos das referências.
  ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.03,
                color: CGColor(srgbRed: 0.05, green: 0.25, blue: 0.02, alpha: 0.28))
  power(ctx, cx: s / 2, cy: s * 0.47, r: s * 0.245, stroke: s * 0.085, color: BRANCO)
  return ctx
}

// ---------------------------------------------------------------- wordmark "DAY" + pílula "ON"
func font(_ names: [String], _ size: CGFloat) -> CTFont {
  for n in names {
    let f = CTFontCreateWithName(n as CFString, size, nil)
    if (CTFontCopyPostScriptName(f) as String) == n { return f }
  }
  return CTFontCreateWithName("Georgia-BoldItalic" as CFString, size, nil)
}
let SERIF = ["TimesNewRomanPS-BoldItalicMT", "Times-BoldItalic", "Charter-BlackItalic", "Georgia-BoldItalic"]

func line(_ text: String, _ f: CTFont, _ color: CGColor) -> CTLine {
  let attr = NSAttributedString(string: text, attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): f,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
  ])
  return CTLineCreateWithAttributedString(attr)
}

/// Desenha o wordmark com a largura total `width`, centrado em (cx, cy). Devolve nada; tudo vetorial.
func wordmark(_ ctx: CGContext, cx: CGFloat, cy: CGFloat, width: CGFloat) {
  // Medidas para um tamanho de fonte 1000, depois escala.
  let F: CGFloat = 1000
  let day = line("DAY", font(SERIF, F), TINTA)
  let dayW = CGFloat(CTLineGetTypographicBounds(day, nil, nil, nil))
  let cap = CTFontGetCapHeight(font(SERIF, F))
  let pillH = cap * 1.18
  let nFont = font(SERIF, F * 0.74)
  let nLine = line("N", nFont, BRANCO)
  let nW = CGFloat(CTLineGetTypographicBounds(nLine, nil, nil, nil))
  let nCap = CTFontGetCapHeight(nFont)
  let oD = nCap * 1.0
  let padL = pillH * 0.24, padR = pillH * 0.30, gapON = pillH * 0.02
  let pillW = padL + oD + gapON + nW + padR
  let gap = F * 0.05
  let total = dayW + gap + pillW
  let k = width / total

  ctx.saveGState()
  ctx.translateBy(x: cx - width / 2, y: cy - cap * k / 2)
  ctx.scaleBy(x: k, y: k)
  // "DAY" na linha de base 0 (as maiúsculas vão de 0 a `cap`)
  ctx.textPosition = .zero
  CTLineDraw(day, ctx)
  // Pílula: centrada na altura das maiúsculas, levemente inclinada como o itálico.
  let px = dayW + gap, py = cap / 2 - pillH / 2
  let pill = CGPath(roundedRect: CGRect(x: px, y: py, width: pillW, height: pillH),
                    cornerWidth: pillH / 2, cornerHeight: pillH / 2, transform: nil)
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -pillH * 0.05), blur: pillH * 0.12,
                color: CGColor(srgbRed: 0.1, green: 0.35, blue: 0.05, alpha: 0.25))
  ctx.addPath(pill); ctx.setFillColor(FOLHA); ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  ctx.addPath(pill); ctx.clip()
  let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [LIMA, FOLHA] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(grad, start: CGPoint(x: px, y: py + pillH), end: CGPoint(x: px + pillW, y: py), options: [])
  ctx.restoreGState()
  // "O" como símbolo de ligar, e o "N" em serifa itálica branca
  let oCx = px + padL + oD / 2, oCy = cap / 2
  power(ctx, cx: oCx, cy: oCy - oD * 0.04, r: oD * 0.40, stroke: oD * 0.15, color: BRANCO)
  ctx.textPosition = CGPoint(x: px + padL + oD + gapON, y: cap / 2 - nCap / 2)
  CTLineDraw(nLine, ctx)
  ctx.restoreGState()
}

// ---------------------------------------------------------------- telas de abertura
let splashBase = loadImage(RAW + "/splash-base.png")

func drawSplash(w: Int, h: Int) -> CGContext {
  let ctx = context(w, h, alpha: false)
  let W = CGFloat(w), H = CGFloat(h)
  ctx.setFillColor(BRANCO); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  // A base do Higgsfield (retrato) cobrindo a tela pela altura; as bordas dela já são brancas.
  let bw = CGFloat(splashBase.width), bh = CGFloat(splashBase.height)
  let sc = max(W / bw, H / bh)
  ctx.draw(splashBase, in: CGRect(x: (W - bw * sc) / 2, y: (H - bh * sc) / 2, width: bw * sc, height: bh * sc))
  // O iOS recorta o quadrado de 2732 para a tela do iPhone: lá o logo precisa caber no meio.
  let markW = w == h ? W * 0.30 : min(W, H) * 0.56
  wordmark(ctx, cx: W / 2, cy: H / 2, width: markW)
  return ctx
}

// ---------------------------------------------------------------- saídas
let RES = "android/app/src/main/res"
let DENS: [(String, CGFloat)] = [("ldpi", 0.75), ("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]

writePNG(drawIcon(size: 1024), "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
writePNG(drawIcon(size: 1024), "ios/App/Watch/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png")
writePNG(drawIcon(size: 180), "public/icon-180.png")
writePNG(drawIcon(size: 512), "public/icon-512.png")
writePNG(drawIcon(size: 112), "public/app-icons/default.png")
for px in [48, 96, 180, 192, 512] { writePNG(drawIcon(size: px), ROOT + "/website/icon-\(px).png") }
for (d, f) in DENS {
  let l = Int((48 * f).rounded()), a = Int((108 * f).rounded())
  writePNG(drawIcon(size: l), "\(RES)/mipmap-\(d)/ic_launcher.png")
  writePNG(drawIcon(size: l, round: true), "\(RES)/mipmap-\(d)/ic_launcher_round.png", opaque: false)
  writePNG(drawIcon(size: a), "\(RES)/mipmap-\(d)/ic_launcher_foreground.png")
  let bg = context(a, a, alpha: false); bg.draw(gradCrop, in: CGRect(x: 0, y: 0, width: a, height: a))
  writePNG(bg, "\(RES)/mipmap-\(d)/ic_launcher_background.png")
}
// favicon.ico: um PNG de 48 px dentro do contêiner ICO.
do {
  let tmp = NSTemporaryDirectory() + "dayon-fav.png"
  writePNG(drawIcon(size: 48), tmp)
  let png = try Data(contentsOf: URL(fileURLWithPath: tmp))
  var ico = Data([0, 0, 1, 0, 1, 0, 48, 48, 0, 0, 1, 0, 32, 0])
  var len = UInt32(png.count).littleEndian, off = UInt32(22).littleEndian
  ico.append(Data(bytes: &len, count: 4)); ico.append(Data(bytes: &off, count: 4)); ico.append(png)
  try ico.write(to: URL(fileURLWithPath: ROOT + "/website/favicon.ico"))
}
// Telas de abertura: os mesmos tamanhos que já existem no projeto.
var splashes: [String] = []
let set = "ios/App/App/Assets.xcassets/Splash.imageset"
for f in (try? fm.contentsOfDirectory(atPath: FRONT + "/" + set)) ?? [] where f.hasSuffix(".png") { splashes.append(set + "/" + f) }
for d in (try? fm.contentsOfDirectory(atPath: FRONT + "/" + RES)) ?? [] where d.hasPrefix("drawable") {
  let p = "\(RES)/\(d)/splash.png"
  if fm.fileExists(atPath: FRONT + "/" + p) { splashes.append(p) }
}
for p in splashes.sorted() {
  guard let (w, h) = pngSize(p) else { continue }
  writePNG(drawSplash(w: w, h: h), p)
}
// O wordmark sozinho (fundo transparente), para documentos e para conferir o desenho.
let wm = context(1600, 400, alpha: true)
wordmark(wm, cx: 800, cy: 200, width: 1440)
writePNG(wm, ROOT + "/design-ref/dayon-wordmark.png", opaque: false)
print("marca DAYON escrita: ícones, \(splashes.count) telas de abertura, favicon e wordmark")
