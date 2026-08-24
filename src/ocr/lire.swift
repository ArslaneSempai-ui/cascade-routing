//
//  LIRE UNE IMAGE, ET DIRE QUAND ON N'A PAS PU.
//
//  Première version : `try?` sur l'appel Vision, `exit(1)` muet sur une image illisible.
//  Trois états différents rendaient alors la même chose — une page sans texte, une image
//  qu'on n'a pas su ouvrir, et une reconnaissance qui a échoué — et le premier est un FAIT
//  quand les deux autres sont des PANNES. Une mesure de fidélité aurait lu une panne comme
//  un mauvais taux d'OCR, et on aurait cherché du côté du modèle.
//
//  Chaque sortie porte donc son code et sa raison. Le tableau vide reste possible : il veut
//  dire « j'ai regardé et il n'y a pas de texte », et il sort à zéro.
//
import Vision
import AppKit
import Foundation

func mourir(_ code: Int32, _ pourquoi: String) -> Never {
    FileHandle.standardError.write(Data("lire: \(pourquoi)\n".utf8))
    exit(code)
}

guard CommandLine.arguments.count >= 2 else {
    mourir(2, "aucun chemin donné — usage : lire <image>")
}
let p = CommandLine.arguments[1]

guard FileManager.default.fileExists(atPath: p) else {
    mourir(3, "fichier introuvable : \(p)")
}
guard let img = NSImage(contentsOfFile: p) else {
    mourir(3, "ce fichier n'est pas une image lisible : \(p)")
}
guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    mourir(3, "image ouverte mais sans bitmap exploitable : \(p)")
}

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

//  L'ÉCHEC DE LA RECONNAISSANCE NE SE CONFOND PLUS AVEC UNE PAGE VIDE.
do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
} catch {
    mourir(4, "la reconnaissance a échoué sur \(p) : \(error.localizedDescription)")
}

guard let json = try? JSONSerialization.data(withJSONObject: lignes),
      let texte = String(data: json, encoding: .utf8) else {
    mourir(5, "les \(lignes.count) bloc(s) lus ne se sérialisent pas en JSON")
}
print(texte)
