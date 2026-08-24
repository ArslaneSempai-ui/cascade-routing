import Vision
import AppKit
import Foundation

let p = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: p),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
var lignes: [[String: Any]] = []
let req = VNRecognizeTextRequest { r, _ in
  for o in (r.results as? [VNRecognizedTextObservation] ?? []) {
    guard let t = o.topCandidates(1).first else { continue }
    lignes.append([
      "texte": t.string,
      "tlx": Double(o.topLeft.x), "tly": Double(1 - o.topLeft.y),
      "trx": Double(o.topRight.x), "try": Double(1 - o.topRight.y),
      "confiance": Double(t.confidence),
    ])
  }
}
req.recognitionLevel = .accurate
req.recognitionLanguages = ["en-US", "fr-FR"]
req.usesLanguageCorrection = false
req.minimumTextHeight = 0.005
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
print(String(data: try! JSONSerialization.data(withJSONObject: lignes), encoding: .utf8)!)
