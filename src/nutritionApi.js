// src/nutritionApi.js
// Uses API Ninjas Nutrition API: https://api.api-ninjas.com/v1/nutrition

const API_URL = "https://api.api-ninjas.com/v1/nutrition?query=";

// ⚠️ IMPORTANT:
// Replace "YOUR_API_KEY_HERE" with your real key in VS Code.
// Example: const API_KEY = "4+MuAc/...";
// Do NOT paste your key again in chat.
const API_KEY = "4+MuAc/cKrvShiUqT9gClA==EUUdqDYoAJIx6BLh";

export async function fetchNutritionForFood(foodName) {
  if (!foodName) return null;

  try {
    const res = await fetch(API_URL + encodeURIComponent(foodName), {
      method: "GET",
      headers: {
        "X-Api-Key": API_KEY,
      },
    });

    if (!res.ok) {
      console.error("Nutrition API error status:", res.status);
      return null;
    }

    const data = await res.json();

    // API returns an array of items – take the first one
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const item = data[0];

    // Convert to per 100g
    const serving = item.serving_size_g || 100;
    const factor = serving ? 100 / serving : 1;

    const caloriesPer100g = (item.calories || 0) * factor;
    const sugar_g = (item.sugar_g || 0) * factor;
    const fat_g = (item.fat_total_g || 0) * factor;
    const protein_g = (item.protein_g || 0) * factor;

    const name = item.name || foodName;

    return {
      // match shape of FOOD_DATABASE items
      name,
      category: "from API",
      caloriesPer100g: Math.round(caloriesPer100g),
      sugar_g: round1(sugar_g),
      fat_g: round1(fat_g),
      protein_g: round1(protein_g),
      processed: guessProcessed(name),
      tags: buildTags(caloriesPer100g, sugar_g, fat_g, protein_g, name),
    };
  } catch (err) {
    console.error("Failed to fetch nutrition:", err);
    return null;
  }
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function guessProcessed(nameRaw) {
  const name = (nameRaw || "").toLowerCase();
  if (
    name.includes("burger") ||
    name.includes("fries") ||
    name.includes("pizza") ||
    name.includes("cola") ||
    name.includes("soda") ||
    name.includes("chips") ||
    name.includes("biscuit") ||
    name.includes("cookie") ||
    name.includes("cake") ||
    name.includes("noodles")
  ) {
    return true;
  }
  return false;
}

function buildTags(caloriesPer100g, sugar_g, fat_g, protein_g, nameRaw) {
  const tags = [];
  const name = (nameRaw || "").toLowerCase();

  if (caloriesPer100g > 250) tags.push("high_calorie");
  if (sugar_g > 10) tags.push("high_sugar");
  if (fat_g > 12) tags.push("high_fat");
  if (protein_g >= 8) tags.push("protein_rich");

  if (
    name.includes("apple") ||
    name.includes("banana") ||
    name.includes("orange") ||
    name.includes("mango") ||
    name.includes("fruit")
  ) {
    tags.push("fruit");
  }
  if (
    name.includes("steamed") ||
    name.includes("boiled") ||
    name.includes("salad")
  ) {
    tags.push("steamed");
  }
  if (name.includes("fried")) {
    tags.push("fried");
  }
  if (
    name.includes("burger") ||
    name.includes("pizza") ||
    name.includes("fries") ||
    name.includes("chips") ||
    name.includes("cola") ||
    name.includes("soda")
  ) {
    tags.push("junk");
  }

  return tags;
}
