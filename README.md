# app-gtfs-map

Application de cartographie pour [data-fair](https://github.com/data-fair/data-fair) : réseau de transport GTFS avec positions de véhicules en temps réel (GTFS-RT).

## Fonctionnement

L'application s'appuie sur le traitement [processing-gtfs](https://github.com/data-fair/processing-gtfs), qui produit 4 jeux de données :

- **métadonnées** : jeu sans données, porteur de l'archive GTFS en pièce jointe et, si configurée, du flux GTFS-RT en pièce jointe distante (`gtfs-rt.protobuf`) ;
- **tracés** : une LineString par forme (couleur GTFS incluse) ;
- **arrêts** : un point par arrêt, avec les lignes desservies ;
- **horaires** : un passage par arrêt et par course (pour les prochains passages).

La configuration ne demande que la sélection du jeu de métadonnées : les 3 jeux liés sont détectés automatiquement (`relatedDatasets`, classification par schéma) et injectés dans la configuration dans des champs cachés. L'URL du flux GTFS-RT est découverte dans les pièces jointes distantes et téléchargée via le proxy data-fair : pas de contrainte de CORS.

## Couches de la carte

- tracés des lignes, colorés d'après `route_color` ;
- arrêts (noms affichés aux zooms élevés) ;
- véhicules en temps réel, rafraîchis par polling du flux VehiclePositions (défaut : 15 s), colorés par ligne.

Clic sur une ligne, un arrêt ou un véhicule pour un popup (les arrêts affichent les prochains passages du jour calculés à partir du jeu « horaires »).

## Développement

```bash
npm install
npm run dev        # vite + df-dev-server dans zellij
npm test           # tests playwright (unit + e2e)
npm run quality    # lint + types + build + tests + audit
```
