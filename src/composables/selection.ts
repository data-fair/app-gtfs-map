import type { VehicleProperties } from './use-vehicles.js'

/**
 * Élément dont le détail est affiché dans la section « Sélection » du panneau :
 * une ligne, un arrêt ou un véhicule. La ligne n'est stockée que par son
 * identifiant, résolu au rendu depuis l'index des lignes (données toujours
 * fraîches) ; le véhicule porte un instantané utilisé en repli quand il
 * disparaît du flux temps réel.
 */
export type Selection =
  | { kind: 'route', routeId: string }
  | { kind: 'stop', stopId: string, stopName: string, routes: string }
  | { kind: 'vehicle', vehicleId: string, vehicle: VehicleProperties }
