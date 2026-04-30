export interface TeamMember {
  name: string;
  dietaryRestrictions: string[]; // e.g. ["vegetarian", "no-peanuts"]
  cuisinePreferences: string[];  // e.g. ["north-indian", "chinese"]
  dishPreferences: string[];     // e.g. ["biryani", "paneer"]
  spiceLevel: "mild" | "medium" | "spicy" | "any";
}

export interface PartyConfig {
  eventName: string;
  deliveryAddressLabel: string; // matches Swiggy saved address label, e.g. "Office"
  maxBudgetPerPerson: number;   // in INR
  members: TeamMember[];
}

export interface CartGroup {
  members: TeamMember[];
  totalEstimate: number;
}

export interface CartItem {
  memberName: string;
  dish: string;
  restaurantItem: string;
  itemId: string;
  quantity: number;
  price: number;
}

export interface OrderSummary {
  restaurantName: string;
  restaurantId: string;
  addressId: string;
  items: CartItem[];
  subtotal: number;
  couponCode?: string;
  discount?: number;
  total: number;
  groupIndex: number;
  totalGroups: number;
}
