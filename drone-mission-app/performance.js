/**
 * performance.js
 * Catalogue des types d'ordinateur de traitement photogrammétrique et de
 * leur coefficient de performance (utilisé par traitement.js pour pondérer
 * les temps de traitement estimés). Portable = référence (coefficient 1.00).
 */

'use strict';

const Performance = (() => {

  const DEFAULTS = {
    typeSelectionne: 'portable',
    types: {
      portable: {
        nom: 'Ordinateur portable',
        config: 'Intel Core i5/i7 ou AMD Ryzen 5/7 · 16 Go RAM · SSD 512 Go · GPU intégré ou milieu de gamme',
        coefficient: 1.00
      },
      bureau: {
        nom: 'Ordinateur de bureau',
        config: 'Intel Core i7/i9 ou Ryzen 7/9 · 32 Go RAM · SSD NVMe · NVIDIA RTX',
        coefficient: 0.65
      },
      station: {
        nom: 'Station de travail',
        config: 'Xeon ou Threadripper · 64 à 256 Go RAM · plusieurs SSD NVMe · RTX professionnelle',
        coefficient: 0.35
      },
      serveur: {
        nom: 'Serveur de calcul',
        config: 'Multi CPU · 128 à 1024 Go RAM · RAID/NVMe · plusieurs GPU',
        coefficient: 0.20
      }
    }
  };

  /** Retourne le coefficient du type sélectionné, ou celui de 'portable' si absent/inconnu. */
  function coefficientDe(types, typeSelectionne) {
    const t = types[typeSelectionne];
    return t ? t.coefficient : types.portable.coefficient;
  }

  return { DEFAULTS, coefficientDe };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Performance;
