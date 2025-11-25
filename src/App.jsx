import { useState, useEffect } from "react";
import { FOOD_DATABASE } from "./foodData";
import { fetchNutritionForFood } from "./nutritionApi";
import { auth, googleProvider, db } from "./firebase";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

function App() {
  const [queryText, setQueryText] = useState("");
  const [goal, setGoal] = useState("general");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingApi, setLoadingApi] = useState(false);

  // portion size for user plate
  const [portion, setPortion] = useState("100");

  // compare feature state (local DB only)
  const [compare1, setCompare1] = useState("");
  const [compare2, setCompare2] = useState("");
  const [compareResult, setCompareResult] = useState(null);
  const [compareError, setCompareError] = useState("");

  // suggestions for main food input
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Watch auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
    });
    return () => unsub();
  }, []);

  // Load history from Firestore when user changes
  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const historyRef = collection(db, "users", user.uid, "history");
    const q = query(historyRef, orderBy("timestamp", "desc"), limit(10));

    const unsub = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setHistory(items);
    });

    return () => unsub();
  }, [user]);

  // handle main input change + build suggestions
  const handleQueryChange = (e) => {
    const value = e.target.value;
    setQueryText(value);
    setError("");
    setResult(null);

    if (!value.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const lower = value.toLowerCase();

    // simple case-insensitive contains search
    const matches = FOOD_DATABASE.filter((item) =>
      item.name.toLowerCase().includes(lower)
    ).slice(0, 10); // limit to 10 suggestions

    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  };

  // user clicks a suggestion -> fill input
  const handleSuggestionClick = (name) => {
    setQueryText(name);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  // hide suggestions after blur (with small delay so click still works)
  const handleMainInputBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
    }, 150);
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setCompareResult(null);

    const trimmed = queryText.trim().toLowerCase();
    const portionNumber =
      Number(portion) && Number(portion) > 0 ? Number(portion) : 100;

    if (!trimmed) {
      setError("Please type a food name to analyze.");
      return;
    }

    let foodSource = null;
    let sourceType = "db"; // "db" | "api"

    // 1) Try our quick local DB first (now that spelling is better with suggestions)
    const match = FOOD_DATABASE.find((item) =>
      item.name.toLowerCase().includes(trimmed)
    );

    if (match) {
      foodSource = match;
      sourceType = "db";
    } else {
      // 2) Not in local DB → use online API
      setLoadingApi(true);
      const apiFood = await fetchNutritionForFood(trimmed);
      setLoadingApi(false);

      if (!apiFood) {
        setError(
          "I couldn't find this food in local or online database. Try a simpler name like 'boiled egg', 'plain rice', 'mango', 'grilled chicken'."
        );
        return;
      }

      foodSource = apiFood;
      sourceType = "api";
    }

    const analysis = analyzeFood(foodSource, goal);

    // attach metadata: source + portion
    const analysisWithMeta = {
      ...analysis,
      source: sourceType, // "db" or "api"
      portion_g: portionNumber,
    };

    setResult(analysisWithMeta);

    // Save to Firestore if logged in
    if (user) {
      await addToHistory(analysisWithMeta, goal);
    }
  };

  const addToHistory = async (analysis, goalValue) => {
    try {
      setSaving(true);
      const historyRef = collection(db, "users", user.uid, "history");
      await addDoc(historyRef, {
        foodName: analysis.foodName,
        score: analysis.score,
        verdict: analysis.verdict,
        goal: goalValue,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to save history:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleHistoryClick = (entry) => {
    const match = FOOD_DATABASE.find(
      (item) => item.name.toLowerCase() === entry.foodName.toLowerCase()
    );
    if (!match) {
      setError(
        "This item may have been analyzed from the online database earlier. Type the name again and press Analyze Food to refresh."
      );
      setQueryText(entry.foodName);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const analysis = analyzeFood(match, entry.goal || "general");
    const analysisWithMeta = {
      ...analysis,
      source: "db",
      portion_g: 100,
    };

    setQueryText(entry.foodName);
    setGoal(entry.goal || "general");
    setPortion("100");
    setResult(analysisWithMeta);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Sign-in error:", err);
      alert("Sign-in failed. Check console for details.");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-out error:", err);
    }
  };

  // compare handler (local DB only)
  const handleCompare = (e) => {
    e.preventDefault();
    setCompareError("");
    setCompareResult(null);

    const aName = compare1.trim().toLowerCase();
    const bName = compare2.trim().toLowerCase();

    if (!aName || !bName) {
      setCompareError("Please enter two food names to compare.");
      return;
    }

    if (aName === bName) {
      setCompareError("Enter two different foods to compare.");
      return;
    }

    const foodA = FOOD_DATABASE.find((item) =>
      item.name.toLowerCase().includes(aName)
    );
    const foodB = FOOD_DATABASE.find((item) =>
      item.name.toLowerCase().includes(bName)
    );

    if (!foodA || !foodB) {
      setCompareError(
        "Compare works only with quick DB items. Try: burger, idli, dosa, pizza, fries, banana, apple, cola, milk, biryani."
      );
      return;
    }

    const analysisA = analyzeFood(foodA, goal);
    const analysisB = analyzeFood(foodB, goal);

    let winner = "equal";
    if (analysisA.score > analysisB.score) winner = "a";
    else if (analysisB.score > analysisA.score) winner = "b";

    setCompareResult({
      a: analysisA,
      b: analysisB,
      winner,
      goalUsed: goal,
    });
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>NutriMind AI</h1>
        <p className="subtitle">
          Smart food analysis powered by NutriMind AI 🧠🍽️ Eat better every day.
        </p>

        <div className="auth-bar">
          {user ? (
            <>
              <div className="user-info">
                <span className="avatar">
                  {user.displayName?.[0]?.toUpperCase() || "U"}
                </span>
                <div>
                  <p className="user-name">{user.displayName}</p>
                  <p className="user-email">{user.email}</p>
                </div>
              </div>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="auth-note">
                Sign in to save your food analysis history in the cloud.
              </p>
              <button
                type="button"
                className="primary-btn auth-btn"
                onClick={handleGoogleSignIn}
              >
                Continue with Google
              </button>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {/* single food analyzer */}
        <section className="card form-card">
          <h2>Check your food</h2>
          <form onSubmit={handleAnalyze} className="analyze-form">
            <label className="field-label">
              Food name
              <div className="field-with-suggestions">
                <input
                  type="text"
                  placeholder="e.g. burger, idli, pizza, banana, grilled chicken..."
                  value={queryText}
                  onChange={handleQueryChange}
                  onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                  }}
                  onBlur={handleMainInputBlur}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="suggestions-list">
                    {suggestions.map((item, index) => (
                      <li
                        key={item.name + index}
                        onMouseDown={() => handleSuggestionClick(item.name)}
                        className="suggestion-item"
                      >
                        <span className="suggestion-name">{item.name}</span>
                        {item.category && (
                          <span className="suggestion-category">
                            ({item.category})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            <label className="field-label">
              Your goal
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              >
                <option value="general">General health</option>
                <option value="weight_loss">Weight loss</option>
                <option value="muscle_gain">Muscle gain</option>
                <option value="diabetic_friendly">Diabetic-friendly</option>
              </select>
            </label>

            {/* portion size input */}
            <label className="field-label">
              Portion size (grams)
              <input
                type="number"
                placeholder="e.g. 150"
                value={portion}
                onChange={(e) => setPortion(e.target.value)}
              />
            </label>

            <button type="submit" className="primary-btn">
              {loadingApi
                ? "Analyzing from online DB..."
                : saving && user
                ? "Saving..."
                : "Analyze Food"}
            </button>
          </form>

          {error && <p className="error-text">{error}</p>}

          <p className="hint-text">
            Health score is based on 100g, but numbers also show your portion.
            Try: <span>idli</span>, <span>pizza</span>, <span>veg biryani</span>,{" "}
            <span>grilled chicken</span>, <span>mango</span>,{" "}
            <span>chocolate cake</span>.
          </p>
        </section>

        {result && (
          <section className="results-grid">
            <NutritionCard result={result} />
            <AdviceCard result={result} />
          </section>
        )}

        {/* compare section */}
        <section className="card compare-card">
          <h2>Compare two foods (quick DB)</h2>
          <p className="compare-subtitle">
            See which option is better for <strong>{formatGoal(goal)}</strong>.
          </p>
          <form onSubmit={handleCompare} className="compare-form">
            <div className="compare-fields">
              <label className="field-label">
                Food A
                <input
                  type="text"
                  placeholder="e.g. burger"
                  value={compare1}
                  onChange={(e) => setCompare1(e.target.value)}
                />
              </label>
              <label className="field-label">
                Food B
                <input
                  type="text"
                  placeholder="e.g. idli"
                  value={compare2}
                  onChange={(e) => setCompare2(e.target.value)}
                />
              </label>
            </div>
            <button type="submit" className="secondary-btn wide-btn">
              Compare
            </button>
          </form>

          {compareError && <p className="error-text">{compareError}</p>}

          {compareResult && <CompareCard data={compareResult} />}
        </section>

        {/* history only for logged-in users */}
        {user && history.length > 0 && (
          <section className="card history-card">
            <div className="history-header">
              <h2>Your recent analyses</h2>
            </div>
            <ul className="history-list">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="history-item"
                  onClick={() => handleHistoryClick(entry)}
                >
                  <div className="history-main">
                    <span className="history-food">
                      {entry.foodName.toUpperCase()}
                    </span>
                    <span
                      className={`history-badge history-badge-${mapVerdictToBadge(
                        entry.verdict
                      )}`}
                    >
                      {entry.verdict}
                    </span>
                  </div>
                  <div className="history-meta">
                    <span className="history-goal">
                      Goal: {formatGoal(entry.goal)}
                    </span>
                    <span className="history-score">{entry.score}/100</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="history-hint">
              Tip: Tap any item above to quickly reopen that analysis.
            </p>
          </section>
        )}

        {user && history.length === 0 && (
          <section className="card history-card">
            <h2>Your recent analyses</h2>
            <p className="history-hint">
              You don't have any saved analyses yet. Try analyzing a food and
              it will show up here.
            </p>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Built with ❤️ by NutriMind AI – quick food database + online nutrition
          API so almost any food works 🚀
        </p>
      </footer>
    </div>
  );
}

/* ---------- helpers ---------- */

function mapVerdictToBadge(verdict = "") {
  const v = verdict.toLowerCase();
  if (v.startsWith("great")) return "great";
  if (v.startsWith("okay")) return "ok";
  if (v.startsWith("limit")) return "limit";
  return "avoid";
}

function formatGoal(goal) {
  if (goal === "general") return "General health";
  if (goal === "weight_loss") return "Weight loss";
  if (goal === "muscle_gain") return "Muscle gain";
  if (goal === "diabetic_friendly") return "Diabetic-friendly";
  return goal;
}

function analyzeFood(food, goal) {
  const {
    caloriesPer100g = 0,
    sugar_g = 0,
    fat_g = 0,
    protein_g = 0,
    processed = false,
    category = "",
    tags = [],
  } = food;

  const isFruit = tags.includes("fruit") || category === "fruit";
  const isDrink = category === "drink";
  const isDessert = category === "dessert" || tags.includes("dessert");
  const isSnack = category === "snack" || tags.includes("junk");
  const isFried = tags.includes("fried");
  const isProteinRich = protein_g >= 8;

  let score = 100;

  // Calories effect
  if (caloriesPer100g > 300) score -= 30;
  else if (caloriesPer100g > 180) score -= 18;
  else if (caloriesPer100g > 120) score -= 8;

  // Sugar effect
  if (sugar_g > 20) score -= 30;
  else if (sugar_g > 12) score -= 20;
  else if (sugar_g > 6) score -= 10;

  // Fat effect
  if (fat_g > 20) score -= 25;
  else if (fat_g > 12) score -= 15;
  else if (fat_g > 6) score -= 10;

  // Processing effect
  if (processed) score -= 8;
  if (isFried) score -= 14;
  if (isSnack) score -= 10;

  // Positive score
  if (isProteinRich) score += 10;
  if (isFruit) score += 6;

  let goalNote = "";
  if (goal === "weight_loss") {
    if (caloriesPer100g > 160 || isSnack || isFried) {
      score -= 10;
      goalNote = "Not great for weight loss. Choose lighter, less oily foods.";
    } else {
      goalNote = "Good for losing weight if portion is controlled.";
    }
  } else if (goal === "muscle_gain") {
    if (!isProteinRich) {
      score -= 8;
      goalNote =
        "Needs more protein. Add eggs, paneer, chicken or dal beside this.";
    } else {
      goalNote = "Good protein source — supports muscle building.";
    }
  } else if (goal === "diabetic_friendly") {
    if (sugar_g > 10 || isDessert || isDrink) {
      score -= 20;
      goalNote =
        "High sugar — risky for diabetics. Avoid or eat rarely.";
    } else {
      goalNote = "Sugar is manageable, but portion still matters.";
    }
  } else {
    goalNote = "Good health comes from balance and portion control.";
  }

  score = Math.min(100, Math.max(0, score));

  let verdict, badge;
  if (score >= 80) {
    verdict = "Great choice ✔️";
    badge = "great";
  } else if (score >= 60) {
    verdict = "Okay in moderation 🙂";
    badge = "ok";
  } else if (score >= 40) {
    verdict = "Limit this food ⚠️";
    badge = "limit";
  } else {
    verdict = "Avoid regularly ❌";
    badge = "avoid";
  }

  const quickTips = [];

  if (isFried)
    quickTips.push("Avoid deep-fried foods to reduce unhealthy fats.");
  if (sugar_g > 10) quickTips.push("High sugar — avoid regularly.");
  if (fat_g > 12) quickTips.push("High fat — balance with vegetables.");
  if (protein_g < 4)
    quickTips.push("Low protein — add eggs, dal or beans for balance.");

  if (isFruit) quickTips.push("Whole fruits are better than juices.");
  if (quickTips.length === 0)
    quickTips.push("Good overall — keep portions controlled.");

  let suggestion = "";
  if (score >= 80)
    suggestion =
      "Include more often in your meals. Good nutrition profile! 😄";
  else if (score >= 60)
    suggestion =
      "Decent choice — add salad/veg to improve nutrition and digestion.";
  else if (score >= 40)
    suggestion =
      "Try to replace with healthier alternatives most days of the week.";
  else
    suggestion =
      "Only an occasional treat — try something less sugary/fried.";

  return {
    foodName: food.name,
    category,
    caloriesPer100g,
    sugar_g,
    fat_g,
    protein_g,
    processed,
    score,
    verdict,
    verdictBadge: badge,
    goalNote,
    quickTips,
    suggestion,
  };
}

function getHighlight(result) {
  const { sugar_g, fat_g, protein_g, caloriesPer100g, processed, category } =
    result;

  if (sugar_g > 20) return "⚠️ Very High Sugar";
  if (sugar_g > 12) return "⚠️ High Sugar";

  if (fat_g > 20) return "⚠️ Very High Fat";
  if (fat_g > 12) return "⚠️ High Fat";

  if (processed && (category === "snack" || category === "dessert"))
    return "⚠️ Processed Junk Food";

  if (protein_g >= 12) return "💪 High Protein";
  if (caloriesPer100g < 100 && !processed) return "🌱 Light & Healthy";

  return "✔️ Balanced Choice";
}

function NutritionCard({ result }) {
  const portion = result.portion_g || 100;
  const factor = portion / 100;

  const caloriesPortion = Math.round(result.caloriesPer100g * factor);
  const sugarPortion = +(result.sugar_g * factor).toFixed(1);
  const fatPortion = +(result.fat_g * factor).toFixed(1);
  const proteinPortion = +(result.protein_g * factor).toFixed(1);

  return (
    <div className="card">
      <h2>Nutrition Overview</h2>
      <div className="score-section">
        <div className={`score-circle ${result.verdictBadge}`}>
          <span>{result.score}</span>
          <small>/100</small>
        </div>
        <div className="score-text">
          <h3>{result.foodName.toUpperCase()}</h3>
          <p className={`badge badge-${result.verdictBadge}`}>
            {result.verdict}
          </p>
          <p className="category-text">
            Category: <strong>{result.category}</strong>
            {result.processed && <span className="chip">Processed</span>}
            {!result.processed && (
              <span className="chip chip-good">Less processed</span>
            )}
          </p>
          <p className="highlight-warning">
            {getHighlight(result)}
          </p>

          <p className="portion-text">
            Portion analyzed: <strong>{portion} g</strong>{" "}
            <span style={{ opacity: 0.8 }}>(score is based on 100g)</span>
          </p>
        </div>
      </div>

      <div className="nutri-grid">
        <div className="nutri-item">
          <span className="label">Calories</span>
          <span className="value">
            {result.caloriesPer100g} kcal / 100g
            <br />
            <small>{caloriesPortion} kcal for {portion} g</small>
          </span>
        </div>
        <div className="nutri-item">
          <span className="label">Sugar</span>
          <span className="value">
            {result.sugar_g} g / 100g
            <br />
            <small>{sugarPortion} g for {portion} g</small>
          </span>
        </div>
        <div className="nutri-item">
          <span className="label">Fat</span>
          <span className="value">
            {result.fat_g} g / 100g
            <br />
            <small>{fatPortion} g for {portion} g</small>
          </span>
        </div>
        <div className="nutri-item">
          <span className="label">Protein</span>
          <span className="value">
            {result.protein_g} g / 100g
            <br />
            <small>{proteinPortion} g for {portion} g</small>
          </span>
        </div>
      </div>
    </div>
  );
}

function AdviceCard({ result }) {
  return (
    <div className="card">
      <h2>Smart Advice</h2>
      <p className="goal-note">{result.goalNote}</p>

      <h3>Quick Tips</h3>
      <ul className="tips-list">
        {result.quickTips.map((tip, i) => (
          <li key={i}>{tip}</li>
        ))}
      </ul>

      <h3>Suggestion</h3>
      <p>{result.suggestion}</p>

      <p className="disclaimer">
        ⚠️ This is an educational tool only and not medical advice. For medical
        or diet-related decisions, always talk to a healthcare professional.
      </p>
    </div>
  );
}

function CompareCard({ data }) {
  const { a, b, winner, goalUsed } = data;

  const labelGoal = formatGoal(goalUsed);

  let summaryText = "";
  if (winner === "a") {
    summaryText = `${a.foodName.toUpperCase()} is generally a better choice than ${b.foodName.toUpperCase()} for ${labelGoal.toLowerCase()}.`;
  } else if (winner === "b") {
    summaryText = `${b.foodName.toUpperCase()} is generally a better choice than ${a.foodName.toUpperCase()} for ${labelGoal.toLowerCase()}.`;
  } else {
    summaryText = `Both foods are quite similar for ${labelGoal.toLowerCase()}. Focus on portion size and frequency.`;
  }

  return (
    <div className="compare-result">
      <p className="compare-summary">{summaryText}</p>

      <div className="compare-grid">
        <div className="compare-column">
          <h3>
            A: {a.foodName.toUpperCase()}{" "}
            {winner === "a" && <span className="chip chip-good">Better</span>}
          </h3>
          <p className={`badge badge-${a.verdictBadge}`}>{a.verdict}</p>
          <p className="compare-score">{a.score}/100 health score</p>
          <ul className="compare-list">
            <li>Calories: {a.caloriesPer100g} kcal / 100g</li>
            <li>Sugar: {a.sugar_g} g</li>
            <li>Fat: {a.fat_g} g</li>
            <li>Protein: {a.protein_g} g</li>
          </ul>
        </div>

        <div className="compare-column">
          <h3>
            B: {b.foodName.toUpperCase()}{" "}
            {winner === "b" && <span className="chip chip-good">Better</span>}
          </h3>
          <p className={`badge badge-${b.verdictBadge}`}>{b.verdict}</p>
          <p className="compare-score">{b.score}/100 health score</p>
          <ul className="compare-list">
            <li>Calories: {b.caloriesPer100g} kcal / 100g</li>
            <li>Sugar: {b.sugar_g} g</li>
            <li>Fat: {b.fat_g} g</li>
            <li>Protein: {b.protein_g} g</li>
          </ul>
        </div>
      </div>

      <p className="compare-note">
        Tip: Even if one option is healthier, how often and how much you eat
        matters a lot.
      </p>
    </div>
  );
}

export default App;
