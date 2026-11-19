/**
 * Demo catalogue for the customer app (seeded into the emulators). Prices are in INR.
 * `imageKey` refers to an illustration in @instasupply/art.
 */
import type { Category, Product } from '@instasupply/shared';

export type SeedCategory = Omit<Category, 'id'> & { id: string };
export type SeedProduct = Pick<
  Product,
  'name' | 'categoryId' | 'unit' | 'price' | 'mrp' | 'description' | 'imageKey' | 'badge' | 'featured' | 'stock'
> & { id: string };

export const CATEGORIES: SeedCategory[] = [
  { id: 'vegetables', name: 'Vegetables', iconKey: 'cat-vegetables', tint: '#E6F2EA', accent: '#28B446', sortOrder: 1 },
  { id: 'fruits', name: 'Fruits', iconKey: 'cat-fruits', tint: '#FFE9E5', accent: '#F55A4E', sortOrder: 2 },
  { id: 'beverages', name: 'Beverages', iconKey: 'cat-beverages', tint: '#FFF6E3', accent: '#F7B500', sortOrder: 3 },
  { id: 'grocery', name: 'Grocery', iconKey: 'cat-grocery', tint: '#F3EFFA', accent: '#A259FF', sortOrder: 4 },
  { id: 'edible-oil', name: 'Edible oil', iconKey: 'cat-edible-oil', tint: '#DCF4F5', accent: '#0CC0DF', sortOrder: 5 },
  { id: 'household', name: 'Household', iconKey: 'cat-household', tint: '#FFE8F2', accent: '#FF5A9E', sortOrder: 6 },
  { id: 'babycare', name: 'Babycare', iconKey: 'cat-babycare', tint: '#D2EFFF', accent: '#2F9BEA', sortOrder: 7 },
];

const p = (product: SeedProduct) => product;

export const PRODUCTS: SeedProduct[] = [
  // Fruits
  p({ id: 'shimla-apple', name: 'Shimla Apple', categoryId: 'fruits', unit: '1 kg', price: 189, mrp: 220, imageKey: 'apple', badge: null, featured: true, stock: 80, description: 'Crisp, juicy apples from the orchards of Himachal. Naturally sweet with a gentle tartness — perfect for snacking, salads and lunch boxes.' }),
  p({ id: 'robusta-banana', name: 'Robusta Banana', categoryId: 'fruits', unit: '1 dozen', price: 59, mrp: null, imageKey: 'banana', badge: null, featured: false, stock: 120, description: 'Ripe, creamy bananas packed with potassium and natural energy. Great for breakfast bowls, smoothies and baking.' }),
  p({ id: 'hass-avocado', name: 'Hass Avocado', categoryId: 'fruits', unit: '2 pcs', price: 249, mrp: 299, imageKey: 'avocado', badge: 'organic', featured: true, stock: 40, description: 'Buttery Hass avocados, ready to eat in 1–2 days. Mash on toast, blend into smoothies or slice into salads.' }),
  p({ id: 'fresh-lime', name: 'Fresh Lime', categoryId: 'fruits', unit: '250 g', price: 39, mrp: null, imageKey: 'lemon', badge: 'organic', featured: true, stock: 150, description: 'Zesty, thin-skinned limes bursting with juice. Your go-to for nimbu pani, dressings and a squeeze over everything.' }),
  p({ id: 'nagpur-orange', name: 'Nagpur Orange', categoryId: 'fruits', unit: '1 kg', price: 119, mrp: null, imageKey: 'orange', badge: null, featured: false, stock: 90, description: 'Sweet and tangy Nagpur oranges with easy-to-peel skin and plenty of vitamin C.' }),
  p({ id: 'strawberry', name: 'Mahabaleshwar Strawberry', categoryId: 'fruits', unit: '200 g', price: 129, mrp: null, imageKey: 'strawberry', badge: 'new', featured: true, stock: 35, description: 'Plump, fragrant strawberries from Mahabaleshwar. Enjoy them fresh, with cream or blended into a shake.' }),
  p({ id: 'black-grapes', name: 'Black Grapes', categoryId: 'fruits', unit: '500 g', price: 99, mrp: null, imageKey: 'grapes', badge: null, featured: true, stock: 70, description: 'Seedless black grapes that are sweet, crunchy and rich in antioxidants.' }),
  p({ id: 'queen-pineapple', name: 'Queen Pineapple', categoryId: 'fruits', unit: '1 pc', price: 79, mrp: null, imageKey: 'pineapple', badge: null, featured: false, stock: 45, description: 'Golden, aromatic pineapple with tender, juicy flesh. Lovely in fruit bowls, juices and grilled.' }),
  p({ id: 'pomegranate', name: 'Bhagwa Pomegranate', categoryId: 'fruits', unit: '1 kg', price: 229, mrp: 260, imageKey: 'pomegranate', badge: null, featured: true, stock: 50, description: 'Deep red Bhagwa pomegranates with sweet, juicy arils. A superfood for salads, raitas and juices.' }),
  p({ id: 'fresh-peach', name: 'Fresh Peach', categoryId: 'fruits', unit: '500 g', price: 169, mrp: null, imageKey: 'peach', badge: 'new', featured: true, stock: 30, description: 'Velvety, sun-ripened peaches with a honeyed aroma. Eat them fresh or bake them into a crumble.' }),
  p({ id: 'watermelon', name: 'Kiran Watermelon', categoryId: 'fruits', unit: '1 pc (~2 kg)', price: 69, mrp: null, imageKey: 'watermelon', badge: null, featured: false, stock: 25, description: 'Sweet, crunchy and incredibly refreshing — the ultimate summer fruit.' }),
  p({ id: 'alphonso-mango', name: 'Alphonso Mango', categoryId: 'fruits', unit: '1 kg', price: 399, mrp: 499, imageKey: 'mango', badge: 'bestseller', featured: true, stock: 40, description: 'The king of mangoes from Ratnagiri: rich, saffron-coloured pulp with an unforgettable aroma.' }),
  // Vegetables
  p({ id: 'fresh-broccoli', name: 'Fresh Broccoli', categoryId: 'vegetables', unit: '250 g', price: 59, mrp: null, imageKey: 'broccoli', badge: 'organic', featured: true, stock: 60, description: 'Tight, deep-green florets that stay crunchy. Steam, stir-fry or roast with garlic.' }),
  p({ id: 'ooty-carrot', name: 'Ooty Carrot', categoryId: 'vegetables', unit: '500 g', price: 45, mrp: null, imageKey: 'carrot', badge: null, featured: false, stock: 100, description: 'Sweet, crunchy carrots from the Nilgiris — great for halwa, salads and soups.' }),
  p({ id: 'hybrid-tomato', name: 'Hybrid Tomato', categoryId: 'vegetables', unit: '1 kg', price: 39, mrp: null, imageKey: 'tomato', badge: null, featured: false, stock: 140, description: 'Firm, juicy tomatoes for everyday curries, chutneys and salads.' }),
  p({ id: 'red-onion', name: 'Red Onion', categoryId: 'vegetables', unit: '1 kg', price: 42, mrp: null, imageKey: 'onion', badge: null, featured: false, stock: 160, description: 'Pungent, flavourful red onions — the base of every great Indian dish.' }),
  p({ id: 'potato', name: 'Potato', categoryId: 'vegetables', unit: '1 kg', price: 35, mrp: null, imageKey: 'potato', badge: null, featured: false, stock: 180, description: 'Versatile, starchy potatoes for fries, curries, parathas and more.' }),
  p({ id: 'english-cucumber', name: 'English Cucumber', categoryId: 'vegetables', unit: '2 pcs', price: 49, mrp: null, imageKey: 'cucumber', badge: null, featured: false, stock: 70, description: 'Long, seedless cucumbers with a cool, crisp bite. Perfect for salads and raita.' }),
  p({ id: 'bell-peppers', name: 'Red & Yellow Bell Peppers', categoryId: 'vegetables', unit: '2 pcs', price: 99, mrp: 119, imageKey: 'bell-pepper', badge: null, featured: true, stock: 45, description: 'Sweet, glossy bell peppers that add colour and crunch to stir-fries, pizzas and salads.' }),
  p({ id: 'palak', name: 'Palak (Spinach)', categoryId: 'vegetables', unit: '1 bunch', price: 29, mrp: null, imageKey: 'spinach', badge: 'organic', featured: false, stock: 80, description: 'Tender, freshly harvested spinach leaves for palak paneer, dal and smoothies.' }),
  // Beverages
  p({ id: 'orange-juice', name: 'Cold-pressed Orange Juice', categoryId: 'beverages', unit: '1 L', price: 189, mrp: 220, imageKey: 'orange-juice', badge: null, featured: false, stock: 40, description: '100% cold-pressed orange juice with no added sugar or preservatives.' }),
  p({ id: 'tender-coconut', name: 'Tender Coconut', categoryId: 'beverages', unit: '1 pc', price: 55, mrp: null, imageKey: 'coconut-water', badge: null, featured: true, stock: 60, description: 'Naturally sweet, electrolyte-rich coconut water straight from the shell.' }),
  p({ id: 'green-tea', name: 'Green Tea', categoryId: 'beverages', unit: '25 bags', price: 149, mrp: null, imageKey: 'green-tea', badge: null, featured: false, stock: 50, description: 'Light, refreshing green tea with a delicate grassy aroma. Rich in antioxidants.' }),
  p({ id: 'cold-coffee', name: 'Iced Cold Coffee', categoryId: 'beverages', unit: '250 ml', price: 89, mrp: null, imageKey: 'cold-coffee', badge: 'new', featured: false, stock: 55, description: 'Smooth, chilled coffee with a creamy finish. Ready to drink.' }),
  // Grocery
  p({ id: 'wheat-bread', name: 'Whole Wheat Bread', categoryId: 'grocery', unit: '400 g', price: 49, mrp: null, imageKey: 'bread', badge: null, featured: false, stock: 60, description: 'Soft, freshly baked whole wheat bread — high in fibre, great for sandwiches and toast.' }),
  p({ id: 'farm-eggs', name: 'Farm Fresh Eggs', categoryId: 'grocery', unit: '12 pcs', price: 96, mrp: null, imageKey: 'eggs', badge: null, featured: true, stock: 75, description: 'Protein-rich eggs from free-range farms, delivered fresh.' }),
  p({ id: 'sona-masoori', name: 'Sona Masoori Rice', categoryId: 'grocery', unit: '5 kg', price: 389, mrp: 450, imageKey: 'rice', badge: 'bestseller', featured: false, stock: 40, description: 'Lightweight, aromatic Sona Masoori rice that cooks soft and fluffy every time.' }),
  p({ id: 'toned-milk', name: 'Toned Milk', categoryId: 'grocery', unit: '1 L', price: 56, mrp: null, imageKey: 'milk', badge: null, featured: false, stock: 120, description: 'Fresh pasteurised toned milk for your daily chai, coffee and cereal.' }),
  p({ id: 'cheddar-cheese', name: 'Cheddar Cheese', categoryId: 'grocery', unit: '200 g', price: 149, mrp: null, imageKey: 'cheese', badge: null, featured: false, stock: 35, description: 'Rich, nutty cheddar that melts beautifully into sandwiches, pasta and toasties.' }),
  // Edible oil
  p({ id: 'sunflower-oil', name: 'Sunflower Oil', categoryId: 'edible-oil', unit: '1 L', price: 165, mrp: 189, imageKey: 'sunflower-oil', badge: null, featured: false, stock: 70, description: 'Light, refined sunflower oil for everyday cooking and frying.' }),
  p({ id: 'olive-oil', name: 'Extra Virgin Olive Oil', categoryId: 'edible-oil', unit: '500 ml', price: 549, mrp: 649, imageKey: 'olive-oil', badge: null, featured: false, stock: 30, description: 'Cold-extracted extra virgin olive oil with a fruity, peppery finish. Ideal for salads and dips.' }),
  // Household
  p({ id: 'liquid-detergent', name: 'Liquid Detergent', categoryId: 'household', unit: '1 L', price: 199, mrp: 240, imageKey: 'detergent', badge: null, featured: false, stock: 50, description: 'Tough-on-stains liquid detergent that is gentle on fabrics and colours.' }),
  p({ id: 'dishwash-gel', name: 'Dishwash Gel', categoryId: 'household', unit: '500 ml', price: 99, mrp: null, imageKey: 'dish-soap', badge: null, featured: false, stock: 65, description: 'Lemon-fresh dishwash gel that cuts through grease in seconds.' }),
  p({ id: 'kitchen-tissue', name: 'Kitchen Tissue Rolls', categoryId: 'household', unit: '4 rolls', price: 149, mrp: null, imageKey: 'tissue-roll', badge: null, featured: false, stock: 45, description: 'Soft, extra-absorbent 2-ply kitchen tissue for spills and wipe-ups.' }),
  // Babycare
  p({ id: 'baby-diapers', name: 'Baby Diapers (M)', categoryId: 'babycare', unit: '42 pcs', price: 699, mrp: 849, imageKey: 'diapers', badge: null, featured: false, stock: 30, description: 'Ultra-soft, breathable diapers with up to 12 hours of leak protection.' }),
  p({ id: 'baby-lotion', name: 'Baby Lotion', categoryId: 'babycare', unit: '200 ml', price: 229, mrp: null, imageKey: 'baby-lotion', badge: null, featured: false, stock: 40, description: 'Mild, hypoallergenic lotion that keeps delicate skin soft and moisturised.' }),
];

/** Seed reviews (reviewer ids are placeholders; no accounts are created for them). */
export const REVIEWS: { productId: string; userName: string; rating: number; text: string }[] = [
  { productId: 'hass-avocado', userName: 'Ananya K.', rating: 5, text: 'Perfectly ripe the next day. Creamy and delicious!' },
  { productId: 'hass-avocado', userName: 'Rohan M.', rating: 4, text: 'Good size, one was slightly firm but ripened well.' },
  { productId: 'alphonso-mango', userName: 'Farah S.', rating: 5, text: 'Tastes exactly like the mangoes from my childhood. Amazing aroma.' },
  { productId: 'alphonso-mango', userName: 'Dev P.', rating: 5, text: 'Sweet, fibre-less and beautifully packed.' },
  { productId: 'fresh-lime', userName: 'Meghna R.', rating: 4, text: 'Very juicy limes, great value.' },
  { productId: 'strawberry', userName: 'Kabir N.', rating: 5, text: 'So fresh and fragrant. Will order again.' },
  { productId: 'fresh-broccoli', userName: 'Ishita V.', rating: 4, text: 'Crisp and green, no yellowing at all.' },
  { productId: 'farm-eggs', userName: 'Arjun T.', rating: 5, text: 'Rich yolks and no broken eggs on delivery.' },
];
