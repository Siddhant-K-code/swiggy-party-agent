# Google Form Template

Copy this structure when creating your team's food preference form.

---

## Form Title
`[Event Name] — Team Food Preferences`

## Form Description
`We're ordering food for the team! Fill this in so we can get everyone something they'll enjoy.`

---

## Questions

**1. Name** *(Short answer, Required)*
> Your full name

**2. Dietary Restrictions** *(Short answer, Optional)*
> e.g. Vegetarian, Vegan, Jain, Halal, Gluten-free, No peanuts, No dairy
> Leave blank if none.

**3. Cuisine Preferences** *(Short answer, Optional)*
> e.g. North Indian, South Indian, Chinese, Italian
> Separate multiple with commas.

**4. Dish Preferences** *(Short answer, Optional)*
> e.g. Biryani, Paneer Tikka, Fried Rice, Pizza
> Separate multiple with commas.

**5. Spice Level** *(Multiple choice, Required)*
> - Mild
> - Medium
> - Spicy
> - Any

---

## Export to CSV

1. Open the form responses in Google Sheets (Responses tab → Sheets icon)
2. File → Download → Comma Separated Values (.csv)
3. Save as `responses.csv`
4. Run: `npx party-agent --csv responses.csv --event "Your Event Name" --address "Office"`

---

## Column Mapping

The parser accepts these column names (case-insensitive):

| Field | Accepted column names |
|-------|-----------------------|
| Name | `Name`, `Full Name`, `Your Name` |
| Dietary Restrictions | `Dietary Restrictions`, `Dietary`, `Diet`, `Restrictions` |
| Cuisine Preferences | `Cuisine Preferences`, `Cuisine`, `Preferred Cuisine` |
| Dish Preferences | `Dish Preferences`, `Dish`, `Preferred Dish`, `Food Preference` |
| Spice Level | `Spice Level`, `Spice`, `Spice Preference` |
