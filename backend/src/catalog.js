// Demo catalogs. Prices ALWAYS come from the seller's catalog, never from the AI.
export const DEMO_CATALOG = {
  NGN: [
    { id: 'ankara-dress', name: 'Ankara dress', price: 15000, aliases: ['ankara gown', 'dress', 'gown'] },
    { id: 'ankara-top', name: 'Ankara top', price: 8000, aliases: ['top', 'blouse'] },
    { id: 'kaftan', name: 'Men kaftan', price: 20000, aliases: ['kaftan', 'senator', 'caftan'] },
    { id: 'adire-yard', name: 'Adire fabric (1 yard)', price: 3500, aliases: ['adire', 'yard', 'fabric'] },
    { id: 'gele', name: 'Aso-oke gele', price: 6000, aliases: ['gele', 'headwrap', 'aso oke', 'aso-oke'] },
    { id: 'beaded-bag', name: 'Beaded bag', price: 12000, aliases: ['bag', 'purse'] },
  ],
  XOF: [
    { id: 'boubou', name: 'Grand boubou', price: 25000, aliases: ['boubou', 'grand boubou'] },
    { id: 'wax-pagne', name: 'Pagne wax (6 yards)', price: 9000, aliases: ['pagne', 'wax', 'tissu'] },
    { id: 'robe', name: 'Robe wax', price: 15000, aliases: ['robe', 'dress'] },
    { id: 'thiouraye', name: 'Thiouraye (encens)', price: 3000, aliases: ['thiouraye', 'encens', 'churai'] },
    { id: 'sac', name: 'Sac en cuir', price: 12000, aliases: ['sac', 'bag'] },
    { id: 'chaussures', name: 'Sandales cuir', price: 8000, aliases: ['sandales', 'chaussures', 'shoes'] },
  ],
};

export function demoCatalog(currency) {
  return structuredClone(DEMO_CATALOG[currency] || DEMO_CATALOG.NGN);
}
