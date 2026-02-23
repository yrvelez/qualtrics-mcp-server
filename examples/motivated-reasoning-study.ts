import { loadConfig } from "./src/config/settings.js";
import { QualtricsClient } from "./src/services/qualtrics-client.js";
import { SurveyApi } from "./src/services/survey-api.js";
import { FlowApi } from "./src/services/flow-api.js";

// ── Configuration ────────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is required");
  process.exit(1);
}
const OPENAI_MODEL = "gpt-4o";

// ── Argument Display: HTML + CSS (editorial style, not chat bubbles) ─

const ARGUMENT_CSS = `
<style>
#arg-wrap{max-width:680px;margin:20px auto;font-family:Georgia,'Times New Roman',Times,serif;color:#1a1a1a}
#arg-header{display:inline-block;background:#c0392b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:4px 12px;border-radius:3px;margin-bottom:16px}
#arg-instruction{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#555;margin-bottom:20px;font-style:italic}
#arg-body{border-left:4px solid #c0392b;padding:24px 28px;background:#fafafa;border-radius:0 8px 8px 0;line-height:1.75;font-size:16.5px}
#arg-body p{margin:0 0 16px 0}
#arg-body p:last-child{margin-bottom:0}
#arg-loading{text-align:center;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
@keyframes argSpin{to{transform:rotate(360deg)}}
.arg-loader{display:inline-block;width:48px;height:48px;border:4px solid #e0e0e0;border-top-color:#c0392b;border-radius:50%;animation:argSpin 1s linear infinite}
</style>
`;

const ARGUMENT_HTML = `
<div id="arg-wrap">
  <div id="arg-loading">
    <div class="arg-loader"></div>
    <p style="margin-top:24px;font-size:17px;color:#444;font-weight:500">Preparing the argument...</p>
    <p style="font-size:13px;color:#999">This will take just a moment.</p>
  </div>
  <div id="arg-content" style="display:none">
    <div id="arg-header">Argument</div>
    <p id="arg-instruction">Please read the following argument carefully before continuing.</p>
    <div id="arg-body"></div>
  </div>
</div>
`;

const ARGUMENT_QUESTION_TEXT = ARGUMENT_CSS + ARGUMENT_HTML;

// ── Item Generation: Loading HTML ────────────────────────────────────

const LOADING_HTML = `
<style>
@keyframes cbSpin{to{transform:rotate(360deg)}}
.cb-loader{display:inline-block;width:48px;height:48px;border:4px solid #e0e0e0;border-top-color:#667eea;border-radius:50%;animation:cbSpin 1s linear infinite}
</style>
<div style="text-align:center;padding:60px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div class="cb-loader"></div>
  <p style="margin-top:24px;font-size:17px;color:#444;font-weight:500">Preparing your personalized questions...</p>
  <p style="font-size:13px;color:#999">This will take just a moment.</p>
</div>
`;

// ── Item Generation JavaScript ───────────────────────────────────────

function makeItemGenJS(): string {
  return `Qualtrics.SurveyEngine.addOnload(function() {
  var qEngine = this;
  qEngine.hideNextButton();

  var issue = Qualtrics.SurveyEngine.getEmbeddedData("ParticipantIssue") || "";
  var position = Qualtrics.SurveyEngine.getEmbeddedData("ParticipantPosition") || "";

  var systemPrompt = "You are a social-science research assistant. Given a participant's most important issue and their position on it, generate exactly 5 belief/attitude statements that measure the strength of their position. Statements should be clear factual or value claims the person would agree with if they hold this position strongly. Range from central to peripheral implications. Keep each under 25 words. Return ONLY a JSON array of 5 strings.";

  var userMsg = "Issue: \\"" + issue + "\\"\\nPosition: \\"" + position + "\\"";

  function setFallbackItems() {
    Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem1", "My position on this issue is well-supported by evidence and logic.");
    Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem2", "People who hold the opposing view are misinformed about key facts.");
    Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem3", "Society would be better off if more people shared my perspective on this.");
    Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem4", "I am confident I could defend my position in a debate.");
    Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem5", "My views on this issue are unlikely to change regardless of new arguments.");
  }

  var timeout = setTimeout(function() {
    setFallbackItems();
    qEngine.clickNextButton();
  }, 25000);

  fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer ${OPENAI_API_KEY}",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "${OPENAI_MODEL}",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg }
      ]
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    clearTimeout(timeout);
    try {
      var text = data.choices[0].message.content;
      var match = text.match(/\\[[\\s\\S]*\\]/);
      if (match) {
        var items = JSON.parse(match[0]);
        Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem1", items[0] || "");
        Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem2", items[1] || "");
        Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem3", items[2] || "");
        Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem4", items[3] || "");
        Qualtrics.SurveyEngine.setEmbeddedData("BeliefItem5", items[4] || "");
      } else {
        setFallbackItems();
      }
    } catch(e) {
      console.error("Parse error:", e);
      setFallbackItems();
    }
    qEngine.clickNextButton();
  })
  .catch(function(err) {
    console.error("OpenAI error:", err);
    clearTimeout(timeout);
    setFallbackItems();
    qEngine.clickNextButton();
  });
});

Qualtrics.SurveyEngine.addOnReady(function() {});
Qualtrics.SurveyEngine.addOnUnload(function() {});`;
}

// ── Argument Display JavaScript: Treatment (Counterargument) ─────────

function makeTreatmentArgumentJS(): string {
  return `Qualtrics.SurveyEngine.addOnload(function() {
  var qEngine = this;
  qEngine.hideNextButton();

  var issue = Qualtrics.SurveyEngine.getEmbeddedData("ParticipantIssue") || "";
  var position = Qualtrics.SurveyEngine.getEmbeddedData("ParticipantPosition") || "";

  var systemPrompt = "You are a ruthless debate opponent. The participant holds a position on a political/social issue. Write a 3-4 paragraph counterargument that viciously attacks their position. Be aggressive, pointed, and unsparing. Use specific evidence, statistics, and expert opinions. Challenge their reasoning directly. Do not hedge or soften your language. Write as a forceful op-ed. Return plain text paragraphs only, no markdown formatting.";

  var userMsg = "Issue: \\"" + issue + "\\"\\nTheir position: \\"" + position + "\\"";

  var timeout = setTimeout(function() {
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = "<p>While many people hold strong views on this topic, the evidence overwhelmingly suggests a more nuanced picture. Leading researchers have repeatedly demonstrated that the most common arguments on this issue fail to account for critical data points that undermine their foundations.</p><p>The economic and social implications of this position have been studied extensively, and the consensus among experts paints a very different picture than what advocates claim. Multiple peer-reviewed studies have found significant flaws in the reasoning typically used to support this view.</p><p>Furthermore, the historical record provides numerous examples where similar positions proved deeply misguided. Those who held onto such views despite mounting evidence to the contrary ultimately found themselves on the wrong side of both the data and public opinion.</p>";
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", "[fallback counterargument]");
    qEngine.showNextButton();
  }, 30000);

  fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer ${OPENAI_API_KEY}",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "${OPENAI_MODEL}",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg }
      ]
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    clearTimeout(timeout);
    var text = data.choices[0].message.content;
    var paragraphs = text.split(/\\n\\n+/).filter(function(p) { return p.trim().length > 0; });
    var html = paragraphs.map(function(p) { return "<p>" + p.trim() + "</p>"; }).join("");
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = html;
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", text);
    qEngine.showNextButton();
  })
  .catch(function(err) {
    console.error("OpenAI error:", err);
    clearTimeout(timeout);
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = "<p>While many people hold strong views on this topic, the evidence overwhelmingly suggests a more nuanced picture. Leading researchers have repeatedly demonstrated that the most common arguments on this issue fail to account for critical data points that undermine their foundations.</p><p>The economic and social implications of this position have been studied extensively, and the consensus among experts paints a very different picture than what advocates claim. Multiple peer-reviewed studies have found significant flaws in the reasoning typically used to support this view.</p><p>Furthermore, the historical record provides numerous examples where similar positions proved deeply misguided. Those who held onto such views despite mounting evidence to the contrary ultimately found themselves on the wrong side of both the data and public opinion.</p>";
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", "[fallback counterargument]");
    qEngine.showNextButton();
  });
});

Qualtrics.SurveyEngine.addOnReady(function() {});
Qualtrics.SurveyEngine.addOnUnload(function() {});`;
}

// ── Argument Display JavaScript: Placebo (Daylight Saving Time) ──────

function makePlaceboArgumentJS(): string {
  return `Qualtrics.SurveyEngine.addOnload(function() {
  var qEngine = this;
  qEngine.hideNextButton();

  var systemPrompt = "Write a 3-4 paragraph persuasive argument for switching the United States to permanent standard time (abolishing daylight saving time). Cite health research, economic impacts, and safety data. Write in an assertive op-ed style. Return plain text paragraphs only, no markdown formatting.";

  var timeout = setTimeout(function() {
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = "<p>The biannual ritual of changing our clocks is not merely an inconvenience — it is a public health hazard that costs lives. Research published in the New England Journal of Medicine demonstrates a 24% increase in heart attacks the Monday after we spring forward, while the American Academy of Sleep Medicine has formally called for the elimination of daylight saving time in favor of permanent standard time.</p><p>The economic toll is equally staggering. A JP Morgan Chase study found that consumer spending drops measurably after the fall time change, and workplace productivity losses from the spring transition cost the U.S. economy an estimated $434 million annually. Meanwhile, the supposed energy savings that originally justified DST have been thoroughly debunked by modern research, including a comprehensive study by the U.S. Department of Energy.</p><p>Safety data makes the case even more urgent. The spring transition is associated with a 6% increase in fatal car accidents in the days following the change. Permanent standard time, which aligns our clocks most closely with solar noon, supports healthier circadian rhythms, better sleep quality, and reduced rates of seasonal depression. The science is clear: it is time to stop changing our clocks.</p>";
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", "[fallback DST argument]");
    qEngine.showNextButton();
  }, 30000);

  fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer ${OPENAI_API_KEY}",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "${OPENAI_MODEL}",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Write the argument now." }
      ]
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    clearTimeout(timeout);
    var text = data.choices[0].message.content;
    var paragraphs = text.split(/\\n\\n+/).filter(function(p) { return p.trim().length > 0; });
    var html = paragraphs.map(function(p) { return "<p>" + p.trim() + "</p>"; }).join("");
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = html;
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", text);
    qEngine.showNextButton();
  })
  .catch(function(err) {
    console.error("OpenAI error:", err);
    clearTimeout(timeout);
    document.getElementById("arg-loading").style.display = "none";
    document.getElementById("arg-content").style.display = "block";
    document.getElementById("arg-body").innerHTML = "<p>The biannual ritual of changing our clocks is not merely an inconvenience — it is a public health hazard that costs lives. Research published in the New England Journal of Medicine demonstrates a 24% increase in heart attacks the Monday after we spring forward, while the American Academy of Sleep Medicine has formally called for the elimination of daylight saving time in favor of permanent standard time.</p><p>The economic toll is equally staggering. A JP Morgan Chase study found that consumer spending drops measurably after the fall time change, and workplace productivity losses from the spring transition cost the U.S. economy an estimated $434 million annually. Meanwhile, the supposed energy savings that originally justified DST have been thoroughly debunked by modern research, including a comprehensive study by the U.S. Department of Energy.</p><p>Safety data makes the case even more urgent. The spring transition is associated with a 6% increase in fatal car accidents in the days following the change. Permanent standard time, which aligns our clocks most closely with solar noon, supports healthier circadian rhythms, better sleep quality, and reduced rates of seasonal depression. The science is clear: it is time to stop changing our clocks.</p>";
    Qualtrics.SurveyEngine.setEmbeddedData("ArgumentText", "[fallback DST argument]");
    qEngine.showNextButton();
  });
});

Qualtrics.SurveyEngine.addOnReady(function() {});
Qualtrics.SurveyEngine.addOnUnload(function() {});`;
}

// ── Helper: add JavaScript to a question via GET+PUT ─────────────────

async function addJSToQuestion(
  surveyApi: SurveyApi,
  surveyId: string,
  questionId: string,
  js: string
): Promise<void> {
  const current = await surveyApi.getQuestion(surveyId, questionId);
  const qDef = current.result;
  qDef.QuestionJS = js;
  await surveyApi.updateQuestion(surveyId, questionId, qDef);
}

// ── Main ─────────────────────────────────────────────────────────────

async function buildMotivatedReasoningStudy() {
  const config = await loadConfig();
  const client = new QualtricsClient(config);
  const surveyApi = new SurveyApi(client);
  const flowApi = new FlowApi(client);

  // ── Step 1: Create the survey ────────────────────────────────────

  console.log("=== Creating survey ===");
  const createResult = await client.createSurvey({
    SurveyName: "Motivated Reasoning: Tailored Counterargument Study",
    Language: "EN",
    ProjectCategory: "CORE",
  });
  const surveyId = createResult.result.SurveyID;
  console.log("Survey ID:", surveyId);

  // Get default block
  const def = await client.getSurveyDefinition(surveyId);
  const defaultBlockId = Object.keys(def.result.Blocks)[0];

  // ── Step 2: Create blocks (10 total) ─────────────────────────────

  console.log("\n=== Creating blocks ===");

  // Block 1: Consent (reuse default block)
  const defaultBlock = await surveyApi.getBlock(surveyId, defaultBlockId);
  await surveyApi.updateBlock(surveyId, defaultBlockId, {
    ...defaultBlock.result,
    Description: "Informed Consent",
  });
  console.log("  Block 1 — Consent:", defaultBlockId);

  // Block 2: Issue Identification
  const issueBlock = await surveyApi.createBlock(surveyId, {
    Description: "Issue Identification",
    Type: "Standard",
  });
  const issueBlockId = issueBlock.result.BlockID;
  console.log("  Block 2 — Issue Identification:", issueBlockId);

  // Block 3: Item Generation (JS auto-advance)
  const itemGenBlock = await surveyApi.createBlock(surveyId, {
    Description: "Item Generation (Loading)",
    Type: "Standard",
  });
  const itemGenBlockId = itemGenBlock.result.BlockID;
  console.log("  Block 3 — Item Generation:", itemGenBlockId);

  // Block 4: Pre-Treatment Measures
  const preBlock = await surveyApi.createBlock(surveyId, {
    Description: "Pre-Treatment Measures",
    Type: "Standard",
  });
  const preBlockId = preBlock.result.BlockID;
  console.log("  Block 4 — Pre-Treatment:", preBlockId);

  // Block 5: Argument — Treatment (counterargument)
  const argTreatmentBlock = await surveyApi.createBlock(surveyId, {
    Description: "Argument: Treatment (Counterargument)",
    Type: "Standard",
  });
  const argTreatmentBlockId = argTreatmentBlock.result.BlockID;
  console.log("  Block 5 — Argument Treatment:", argTreatmentBlockId);

  // Block 6: Argument — Placebo (daylight saving)
  const argPlaceboBlock = await surveyApi.createBlock(surveyId, {
    Description: "Argument: Placebo (Daylight Saving)",
    Type: "Standard",
  });
  const argPlaceboBlockId = argPlaceboBlock.result.BlockID;
  console.log("  Block 6 — Argument Placebo:", argPlaceboBlockId);

  // Block 7: Manipulation Check
  const manipCheckBlock = await surveyApi.createBlock(surveyId, {
    Description: "Manipulation Check",
    Type: "Standard",
  });
  const manipCheckBlockId = manipCheckBlock.result.BlockID;
  console.log("  Block 7 — Manipulation Check:", manipCheckBlockId);

  // Block 8: Post-Treatment Measures
  const postBlock = await surveyApi.createBlock(surveyId, {
    Description: "Post-Treatment Measures",
    Type: "Standard",
  });
  const postBlockId = postBlock.result.BlockID;
  console.log("  Block 8 — Post-Treatment:", postBlockId);

  // Block 9: Demographics
  const demoBlock = await surveyApi.createBlock(surveyId, {
    Description: "Demographics",
    Type: "Standard",
  });
  const demoBlockId = demoBlock.result.BlockID;
  console.log("  Block 9 — Demographics:", demoBlockId);

  // Block 10: Debriefing
  const debriefBlock = await surveyApi.createBlock(surveyId, {
    Description: "Debriefing",
    Type: "Standard",
  });
  const debriefBlockId = debriefBlock.result.BlockID;
  console.log("  Block 10 — Debriefing:", debriefBlockId);

  // ── Step 3: Consent ──────────────────────────────────────────────

  console.log("\n=== Adding consent ===");

  await surveyApi.createQuestion(surveyId, defaultBlockId, {
    QuestionText:
      "<h2>Informed Consent</h2>" +
      "<p>You are being invited to participate in a research study about how people form and maintain beliefs about important issues.</p>" +
      "<p><strong>What you will do:</strong> You will identify an issue important to you, answer questions about your views, read an argument, and answer follow-up questions. The study takes approximately 10 minutes.</p>" +
      "<p><strong>Risks:</strong> You may read arguments that challenge your views on topics you care about. There are no other anticipated risks beyond those of everyday life.</p>" +
      "<p><strong>Confidentiality:</strong> Your responses are anonymous and will be used only for research purposes.</p>" +
      "<p><strong>Voluntary participation:</strong> You may withdraw at any time without penalty.</p>",
    QuestionType: "DB",
    Selector: "TB",
  });

  const consentQ = await surveyApi.createQuestion(surveyId, defaultBlockId, {
    QuestionText: "Do you consent to participate in this study?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Yes, I consent to participate" },
      "2": { Display: "No, I do not wish to participate" },
    },
    ChoiceOrder: ["1", "2"],
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  console.log("  Consent question:", consentQ.result.QuestionID);

  // ── Step 4: Issue Identification ─────────────────────────────────

  console.log("\n=== Adding issue identification ===");

  const issueQ = await surveyApi.createQuestion(surveyId, issueBlockId, {
    QuestionText:
      "What is the most important political or social issue to you personally?",
    QuestionType: "TE",
    Selector: "ESTB",
    DataExportTag: "ParticipantIssueRaw",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  const issueQID = issueQ.result.QuestionID;
  console.log("  Issue question:", issueQID);

  const positionQ = await surveyApi.createQuestion(surveyId, issueBlockId, {
    QuestionText:
      "What is your position on this issue? Please describe what you believe and why in a few sentences.",
    QuestionType: "TE",
    Selector: "ESTB",
    DataExportTag: "ParticipantPositionRaw",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  const positionQID = positionQ.result.QuestionID;
  console.log("  Position question:", positionQID);

  const importanceQ = await surveyApi.createQuestion(surveyId, issueBlockId, {
    QuestionText: "How important is this issue to you?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "1 — Not at all important" },
      "2": { Display: "2" },
      "3": { Display: "3" },
      "4": { Display: "4 — Moderately important" },
      "5": { Display: "5" },
      "6": { Display: "6" },
      "7": { Display: "7 — Extremely important" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5", "6", "7"],
    DataExportTag: "IssueImportanceRaw",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  const importanceQID = importanceQ.result.QuestionID;
  console.log("  Importance question:", importanceQID);

  // ── Step 5: Item Generation (loading page with JS) ───────────────

  console.log("\n=== Adding item generation page ===");

  const itemGenQ = await surveyApi.createQuestion(surveyId, itemGenBlockId, {
    QuestionText: LOADING_HTML,
    QuestionType: "DB",
    Selector: "TB",
  });
  const itemGenQID = itemGenQ.result.QuestionID;
  console.log("  Loading page:", itemGenQID);

  try {
    await addJSToQuestion(surveyApi, surveyId, itemGenQID, makeItemGenJS());
    console.log("  JavaScript added to item generation page");
  } catch (err) {
    console.warn("  Warning: Could not add JS via API. Add manually in Qualtrics editor.");
    console.warn("  Error:", (err as Error).message);
  }

  // ── Step 6: Pre-treatment measures ───────────────────────────────

  console.log("\n=== Adding pre-treatment measures ===");

  const likertScale: Record<string, { Display: string }> = {
    "1": { Display: "Strongly Disagree" },
    "2": { Display: "Disagree" },
    "3": { Display: "Somewhat Disagree" },
    "4": { Display: "Neither Agree nor Disagree" },
    "5": { Display: "Somewhat Agree" },
    "6": { Display: "Agree" },
    "7": { Display: "Strongly Agree" },
  };
  const likertOrder = ["1", "2", "3", "4", "5", "6", "7"];

  await surveyApi.createQuestion(surveyId, preBlockId, {
    QuestionText:
      "<p>Please indicate how much you agree or disagree with each of the following statements.</p>",
    QuestionType: "DB",
    Selector: "TB",
  });

  for (let i = 1; i <= 5; i++) {
    const q = await surveyApi.createQuestion(surveyId, preBlockId, {
      QuestionText: `\${e://Field/BeliefItem${i}}`,
      QuestionType: "MC",
      Selector: "SAVR",
      SubSelector: "TX",
      Choices: likertScale,
      ChoiceOrder: likertOrder,
      DataExportTag: `PreBelief${i}`,
      Validation: {
        Settings: {
          ForceResponse: "ON",
          ForceResponseType: "ON",
          Type: "None",
        },
      },
    });
    console.log(`  Pre-treatment item ${i}:`, q.result.QuestionID);
  }

  // ── Step 7: Argument questions ───────────────────────────────────

  console.log("\n=== Adding argument questions ===");

  // Treatment argument (counterargument)
  const treatmentArgQ = await surveyApi.createQuestion(
    surveyId,
    argTreatmentBlockId,
    {
      QuestionText: ARGUMENT_QUESTION_TEXT,
      QuestionType: "DB",
      Selector: "TB",
    }
  );
  const treatmentArgQID = treatmentArgQ.result.QuestionID;
  console.log("  Treatment argument:", treatmentArgQID);

  try {
    await addJSToQuestion(surveyApi, surveyId, treatmentArgQID, makeTreatmentArgumentJS());
    console.log("  JavaScript added to treatment argument");
  } catch (err) {
    console.warn("  Warning: Could not add JS to treatment argument.");
    console.warn("  Error:", (err as Error).message);
  }

  // Placebo argument (daylight saving time)
  const placeboArgQ = await surveyApi.createQuestion(
    surveyId,
    argPlaceboBlockId,
    {
      QuestionText: ARGUMENT_QUESTION_TEXT,
      QuestionType: "DB",
      Selector: "TB",
    }
  );
  const placeboArgQID = placeboArgQ.result.QuestionID;
  console.log("  Placebo argument:", placeboArgQID);

  try {
    await addJSToQuestion(surveyApi, surveyId, placeboArgQID, makePlaceboArgumentJS());
    console.log("  JavaScript added to placebo argument");
  } catch (err) {
    console.warn("  Warning: Could not add JS to placebo argument.");
    console.warn("  Error:", (err as Error).message);
  }

  // ── Step 8: Manipulation Check ───────────────────────────────────

  console.log("\n=== Adding manipulation check ===");

  const strengthScale: Record<string, { Display: string }> = {
    "1": { Display: "1 — Not at all strong" },
    "2": { Display: "2" },
    "3": { Display: "3" },
    "4": { Display: "4 — Moderately strong" },
    "5": { Display: "5" },
    "6": { Display: "6" },
    "7": { Display: "7 — Extremely strong" },
  };
  const scale7Order = ["1", "2", "3", "4", "5", "6", "7"];

  const argStrengthQ = await surveyApi.createQuestion(surveyId, manipCheckBlockId, {
    QuestionText:
      "How strong or compelling did you find the argument you just read?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: strengthScale,
    ChoiceOrder: scale7Order,
    DataExportTag: "ArgumentStrength",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  console.log("  Argument strength:", argStrengthQ.result.QuestionID);

  const reconsiderScale: Record<string, { Display: string }> = {
    "1": { Display: "1 — Not at all" },
    "2": { Display: "2" },
    "3": { Display: "3" },
    "4": { Display: "4 — Somewhat" },
    "5": { Display: "5" },
    "6": { Display: "6" },
    "7": { Display: "7 — Very much" },
  };

  const reconsiderQ = await surveyApi.createQuestion(surveyId, manipCheckBlockId, {
    QuestionText:
      "How much did the argument make you reconsider your position on the topic it addressed?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: reconsiderScale,
    ChoiceOrder: scale7Order,
    DataExportTag: "PositionReconsider",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  console.log("  Position reconsider:", reconsiderQ.result.QuestionID);

  // ── Step 9: Post-treatment measures ──────────────────────────────

  console.log("\n=== Adding post-treatment measures ===");

  await surveyApi.createQuestion(surveyId, postBlockId, {
    QuestionText:
      "<p>Please indicate how much you agree or disagree with each of the following statements.</p>",
    QuestionType: "DB",
    Selector: "TB",
  });

  for (let i = 1; i <= 5; i++) {
    const q = await surveyApi.createQuestion(surveyId, postBlockId, {
      QuestionText: `\${e://Field/BeliefItem${i}}`,
      QuestionType: "MC",
      Selector: "SAVR",
      SubSelector: "TX",
      Choices: likertScale,
      ChoiceOrder: likertOrder,
      DataExportTag: `PostBelief${i}`,
      Validation: {
        Settings: {
          ForceResponse: "ON",
          ForceResponseType: "ON",
          Type: "None",
        },
      },
    });
    console.log(`  Post-treatment item ${i}:`, q.result.QuestionID);
  }

  // ── Step 10: Demographics ─────────────────────────────────────────

  console.log("\n=== Adding demographics ===");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText: "What is your age?",
    QuestionType: "TE",
    Selector: "SL",
    DataExportTag: "Age",
    Validation: {
      Settings: { ForceResponse: "ON", ForceResponseType: "ON", Type: "None" },
    },
  });
  console.log("  Age");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText: "What is your gender?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Male" },
      "2": { Display: "Female" },
      "3": { Display: "Non-binary / Third gender" },
      "4": { Display: "Prefer to self-describe" },
      "5": { Display: "Prefer not to say" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5"],
    DataExportTag: "Gender",
  });
  console.log("  Gender");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText:
      "What is the highest level of education you have completed?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Less than high school" },
      "2": { Display: "High school diploma / GED" },
      "3": { Display: "Some college, no degree" },
      "4": { Display: "Associate's degree" },
      "5": { Display: "Bachelor's degree" },
      "6": { Display: "Master's degree" },
      "7": { Display: "Doctoral or professional degree" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5", "6", "7"],
    DataExportTag: "Education",
  });
  console.log("  Education");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText: "How would you describe your political views?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Very Liberal" },
      "2": { Display: "Liberal" },
      "3": { Display: "Slightly Liberal" },
      "4": { Display: "Moderate / Middle of the Road" },
      "5": { Display: "Slightly Conservative" },
      "6": { Display: "Conservative" },
      "7": { Display: "Very Conservative" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5", "6", "7"],
    DataExportTag: "PoliticalIdeology",
  });
  console.log("  Political ideology");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText:
      "Generally speaking, do you usually think of yourself as a Democrat, a Republican, an Independent, or what?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Strong Democrat" },
      "2": { Display: "Weak Democrat" },
      "3": { Display: "Independent, Leaning Democrat" },
      "4": { Display: "Independent" },
      "5": { Display: "Independent, Leaning Republican" },
      "6": { Display: "Weak Republican" },
      "7": { Display: "Strong Republican" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5", "6", "7"],
    DataExportTag: "PartyID",
  });
  console.log("  Party ID");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText: "How often do you use social media?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "Never" },
      "2": { Display: "Less than once a week" },
      "3": { Display: "A few times a week" },
      "4": { Display: "About once a day" },
      "5": { Display: "Several times a day" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5"],
    DataExportTag: "SocialMediaUse",
  });
  console.log("  Social media use");

  await surveyApi.createQuestion(surveyId, demoBlockId, {
    QuestionText:
      "How often do you discuss political or social issues with others?",
    QuestionType: "MC",
    Selector: "SAVR",
    SubSelector: "TX",
    Choices: {
      "1": { Display: "1 — Never" },
      "2": { Display: "2" },
      "3": { Display: "3" },
      "4": { Display: "4 — Sometimes" },
      "5": { Display: "5" },
      "6": { Display: "6" },
      "7": { Display: "7 — Very frequently" },
    },
    ChoiceOrder: ["1", "2", "3", "4", "5", "6", "7"],
    DataExportTag: "PoliticalEngagement",
  });
  console.log("  Political engagement");

  // ── Step 11: Debriefing ──────────────────────────────────────────

  console.log("\n=== Adding debriefing ===");

  await surveyApi.createQuestion(surveyId, debriefBlockId, {
    QuestionText:
      "<h2>Debriefing</h2>" +
      "<p>Thank you for completing this study! We want to be transparent about the purpose and methods of this research.</p>" +
      "<p>This study examines <strong>motivated reasoning</strong> — the tendency for people to defend their existing beliefs when confronted with challenging arguments. You were randomly assigned to one of two conditions:</p>" +
      "<ul><li><strong>Treatment group:</strong> You read an AI-generated counterargument that directly challenged your stated position on your chosen issue.</li>" +
      "<li><strong>Control group:</strong> You read an AI-generated argument about abolishing daylight saving time — an unrelated, low-stakes topic.</li></ul>" +
      "<p>The belief statements you rated before and after reading the argument were generated by AI to specifically match the issue and position you described. This allowed us to create a tailored measure of your attitudes.</p>" +
      "<p><strong>Important:</strong> This research does not aim to change your beliefs or judge your views. We are studying a universal psychological phenomenon. If you have questions or concerns, please contact the research team at [email].</p>",
    QuestionType: "DB",
    Selector: "TB",
  });
  console.log("  Debriefing text added");

  // ── Step 12: Build the survey flow ───────────────────────────────

  console.log("\n=== Building survey flow ===");

  const currentFlow = await flowApi.getFlow(surveyId);
  const flow = currentFlow.result;

  flow.Flow = [
    // FL_100: Declare all 13 embedded data fields
    {
      FlowID: "FL_100",
      Type: "EmbeddedData",
      EmbeddedData: [
        { Description: "Condition", Type: "Custom", Field: "Condition", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "ParticipantIssue", Type: "Custom", Field: "ParticipantIssue", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "ParticipantPosition", Type: "Custom", Field: "ParticipantPosition", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "IssueImportance", Type: "Custom", Field: "IssueImportance", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "BeliefItem1", Type: "Custom", Field: "BeliefItem1", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "BeliefItem2", Type: "Custom", Field: "BeliefItem2", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "BeliefItem3", Type: "Custom", Field: "BeliefItem3", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "BeliefItem4", Type: "Custom", Field: "BeliefItem4", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "BeliefItem5", Type: "Custom", Field: "BeliefItem5", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
        { Description: "ArgumentText", Type: "Custom", Field: "ArgumentText", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "" },
      ],
    },

    // FL_101: Consent
    { FlowID: "FL_101", Type: "Block", ID: defaultBlockId, Autofill: [] },

    // FL_102: Issue Identification
    { FlowID: "FL_102", Type: "Block", ID: issueBlockId, Autofill: [] },

    // FL_103: Capture issue responses into embedded data (piped text)
    {
      FlowID: "FL_103",
      Type: "EmbeddedData",
      EmbeddedData: [
        {
          Description: "ParticipantIssue",
          Type: "Custom",
          Field: "ParticipantIssue",
          VariableType: "String",
          DataVisibility: [],
          AnalyzeText: false,
          Value: `\${q://${issueQID}/ChoiceTextEntryValue}`,
        },
        {
          Description: "ParticipantPosition",
          Type: "Custom",
          Field: "ParticipantPosition",
          VariableType: "String",
          DataVisibility: [],
          AnalyzeText: false,
          Value: `\${q://${positionQID}/ChoiceTextEntryValue}`,
        },
        {
          Description: "IssueImportance",
          Type: "Custom",
          Field: "IssueImportance",
          VariableType: "String",
          DataVisibility: [],
          AnalyzeText: false,
          Value: `\${q://${importanceQID}/ChoiceGroup/SelectedChoices}`,
        },
      ],
    },

    // FL_104: Item Generation (JS calls API, auto-advances)
    { FlowID: "FL_104", Type: "Block", ID: itemGenBlockId, Autofill: [] },

    // FL_105: Pre-Treatment Measures
    { FlowID: "FL_105", Type: "Block", ID: preBlockId, Autofill: [] },

    // FL_106: BlockRandomizer — Treatment vs. Placebo
    {
      FlowID: "FL_106",
      Type: "BlockRandomizer",
      SubSet: 1,
      EvenPresentation: true,
      Flow: [
        // Treatment arm: Counterargument
        {
          FlowID: "FL_107",
          Type: "Group",
          Description: "Treatment: Counterargument",
          Flow: [
            {
              FlowID: "FL_108",
              Type: "EmbeddedData",
              EmbeddedData: [
                { Description: "Condition", Type: "Custom", Field: "Condition", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "treatment" },
              ],
            },
            { FlowID: "FL_109", Type: "Block", ID: argTreatmentBlockId, Autofill: [] },
          ],
        },
        // Placebo arm: Daylight Saving
        {
          FlowID: "FL_110",
          Type: "Group",
          Description: "Placebo: Daylight Saving",
          Flow: [
            {
              FlowID: "FL_111",
              Type: "EmbeddedData",
              EmbeddedData: [
                { Description: "Condition", Type: "Custom", Field: "Condition", VariableType: "String", DataVisibility: [], AnalyzeText: false, Value: "placebo" },
              ],
            },
            { FlowID: "FL_112", Type: "Block", ID: argPlaceboBlockId, Autofill: [] },
          ],
        },
      ],
    },

    // FL_113: Manipulation Check
    { FlowID: "FL_113", Type: "Block", ID: manipCheckBlockId, Autofill: [] },

    // FL_114: Post-Treatment Measures
    { FlowID: "FL_114", Type: "Block", ID: postBlockId, Autofill: [] },

    // FL_115: Demographics
    { FlowID: "FL_115", Type: "Block", ID: demoBlockId, Autofill: [] },

    // FL_116: Debriefing
    { FlowID: "FL_116", Type: "Block", ID: debriefBlockId, Autofill: [] },
  ];

  flow.Properties = { Count: 116, RemovedFieldsets: [] };

  await flowApi.updateFlow(surveyId, flow);
  console.log("Survey flow configured with randomization and JS-powered arguments");

  // ── Final verification ───────────────────────────────────────────

  console.log("\n=== Final Verification ===");
  const finalDef = await client.getSurveyDefinition(surveyId);
  const finalFlow = await flowApi.getFlow(surveyId);

  const qCount = Object.keys(finalDef.result.Questions).length;
  const bCount = Object.keys(finalDef.result.Blocks).length;
  const flowElements = finalFlow.result.Flow;

  console.log(`Questions: ${qCount}`);
  console.log(`Blocks: ${bCount}`);
  console.log(`Top-level flow elements: ${flowElements.length}`);
  console.log(`\nSurvey ID: ${surveyId}`);

  // Print flow summary
  console.log("\nFlow structure:");
  function printFlow(elements: any[], indent = "  ") {
    for (const el of elements) {
      let label = `${el.FlowID}: ${el.Type}`;
      if (el.Type === "Block") label += ` [${el.ID}]`;
      if (el.Type === "EmbeddedData")
        label += ` (${el.EmbeddedData?.length || 0} fields)`;
      if (el.Type === "BlockRandomizer")
        label += ` [SubSet=${el.SubSet}, Even=${el.EvenPresentation}]`;
      if (el.Type === "Group") label += ` "${el.Description}"`;
      console.log(`${indent}${label}`);
      if (el.Flow) printFlow(el.Flow, indent + "  ");
    }
  }
  printFlow(flowElements);

  // Check if JS was applied
  const questions = finalDef.result.Questions;
  let jsCount = 0;
  for (const [qid, qDef] of Object.entries(questions) as [string, any][]) {
    if (qDef.QuestionJS) jsCount++;
  }
  console.log(`\nQuestions with JavaScript: ${jsCount}`);

  console.log("\n=== STUDY CREATION COMPLETE ===");
  console.log("\nThis survey calls OpenAI GPT-4o directly from Qualtrics JavaScript.");
  console.log("No external server needed.");
  console.log("\nTo use: activate the survey in Qualtrics.");
  console.log(`\nSurvey link: https://columbiauniversity.yul1.qualtrics.com/survey-builder/${surveyId}/edit`);
}

buildMotivatedReasoningStudy().catch(console.error);
