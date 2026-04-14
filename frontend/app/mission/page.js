"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ActivityInternalMenu from "../components/ActivityInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";
const FULL_TEST_TARGET = 17;
const FORUM_TARGET = 34;
const CAVA_TARGET = 25;
const AXES = [
  "Polity",
  "History",
  "Geography",
  "Economy",
  "Environment",
  "Science & Tech",
  "Current Affairs",
  "CSAT",
  "Essay",
  "Ethics",
  "Answer Writing",
  "Revision",
  "Mock Tests",
];

const AXIS_KEYWORDS = {
  Polity: ["polity", "constitution", "governance", "rights", "panchayati"],
  History: ["history", "modern", "art", "culture", "heritage", "world history", "medieval"],
  Geography: ["geography", "physical", "human", "world physical"],
  Economy: ["economy", "economic", "poverty", "inclusion", "development", "demographics"],
  Environment: ["environment", "ecology", "biodiversity", "climate"],
  "Science & Tech": ["science", "technology", "tech"],
  "Current Affairs": ["current affairs", "ca-va", "news"],
  CSAT: ["csat", "numeracy", "comprehension", "logical", "reasoning", "data interpretation"],
  Essay: ["essay"],
  Ethics: ["ethics", "integrity", "aptitude"],
  "Answer Writing": ["answer", "writing", "mains"],
  Revision: ["revision"],
  "Mock Tests": ["test", "mock", "sfg", "pmp", "cava"],
};

function sanitizeMissionTestRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    test_name: String(row?.test_name || ""),
    source: String(row?.source || ""),
    number_of_tests: Math.max(1, Number(row?.number_of_tests || 1)),
    revisions: Math.max(0, Number(row?.revisions || 0)),
  }));
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function revisionCountFromTopic(topicNode) {
  if (!topicNode || typeof topicNode !== "object") return 0;
  if (Array.isArray(topicNode.revision_dates) && topicNode.revision_dates.length > 0) {
    return topicNode.revision_dates.length;
  }
  let count = 0;
  if (topicNode.first_revision_date) count += 1;
  if (topicNode.second_revision_date) count += 1;
  return count;
}

function hasVideoForTopic(topicNode) {
  const recordings = Array.isArray(topicNode?.recordings) ? topicNode.recordings : [];
  return recordings.some((rec) => {
    const media = Array.isArray(rec?.media_types) ? rec.media_types : [];
    return media.includes("video") || media.includes("screen");
  });
}

function hasNotesForTopic(topicNode) {
  const noteDates = Array.isArray(topicNode?.note_dates) ? topicNode.note_dates : [];
  if (noteDates.length > 0) return true;
  if (topicNode?.note_first_date) return true;
  return Array.isArray(topicNode?.notes) && topicNode.notes.length > 0;
}

function buildMissionExecution(plan, syllabus) {
  const safePlan = plan && typeof plan === "object" ? plan : {};
  const courses = Array.isArray(safePlan.courses) ? safePlan.courses : [];
  const books = Array.isArray(safePlan.books) ? safePlan.books : [];
  const randomRows = Array.isArray(safePlan.random) ? safePlan.random : [];
  const tests = Array.isArray(safePlan.tests) ? safePlan.tests : [];
  const exams = Array.isArray(syllabus?.exams) ? syllabus.exams : [];

  const topicMap = new Map();
  const topicFallbackMap = new Map();
  const testsBySource = new Map();

  exams.forEach((examNode) => {
    const examKey = norm(examNode?.exam);
    (examNode?.subjects || []).forEach((subjectNode) => {
      const subjectKey = norm(subjectNode?.subject);
      (subjectNode?.topics || []).forEach((topicNode) => {
        const topicKey = norm(topicNode?.topic);
        topicMap.set(`${examKey}||${subjectKey}||${topicKey}`, topicNode);
        topicFallbackMap.set(`${subjectKey}||${topicKey}`, topicNode);
      });
    });
    (examNode?.tests || []).forEach((sourceNode) => {
      const sourceKey = norm(sourceNode?.source);
      if (!sourceKey) return;
      const list = testsBySource.get(sourceKey) || [];
      (sourceNode?.tests || []).forEach((testNode) => list.push(testNode));
      testsBySource.set(sourceKey, list);
    });
  });

  const getTopicNode = (examName, subjectName, topicName) => {
    const exact = topicMap.get(`${norm(examName)}||${norm(subjectName)}||${norm(topicName)}`);
    if (exact) return exact;
    return topicFallbackMap.get(`${norm(subjectName)}||${norm(topicName)}`) || null;
  };

  const findTestSlot = (sourceName, testNumber, testName) => {
    const sourceKey = norm(sourceName);
    const list = testsBySource.get(sourceKey) || [];
    const num = String(testNumber || "").trim();
    if (!num) return null;
    const byNum = list.filter((node) => String(node?.test_number || "").trim() === num);
    if (byNum.length === 0) return null;
    const testNameKey = norm(testName);
    if (!testNameKey) return byNum[0];
    const exact = byNum.find((node) => norm(node?.test_name) === testNameKey);
    return exact || byNum[0];
  };

  const out = {
    coursesDone: 0,
    coursesTotal: 0,
    subjectsDone: 0,
    subjectsTotal: 0,
    classesDone: 0,
    classesTotal: 0,
    classVideosDone: 0,
    classVideosTotal: 0,
    classNotesDone: 0,
    classNotesTotal: 0,
    classRevisionsDone: 0,
    classRevisionsTotal: 0,

    booksDone: 0,
    booksTotal: 0,
    chaptersDone: 0,
    chaptersTotal: 0,
    chapterNotesDone: 0,
    chapterNotesTotal: 0,
    chapterRevisionsDone: 0,
    chapterRevisionsTotal: 0,

    randomDone: 0,
    randomTotal: 0,
    randomNotesDone: 0,
    randomNotesTotal: 0,
    randomRevisionsDone: 0,
    randomRevisionsTotal: 0,

    testRowsDone: 0,
    testRowsTotal: 0,
    testsGivenDone: 0,
    testsGivenTotal: 0,
    testsAnalysisDone: 0,
    testsAnalysisTotal: 0,
    testRevisionsDone: 0,
    testRevisionsTotal: 0,
    classVideoItems: [],
  };

  const courseGroups = new Map();
  courses.forEach((row) => {
    const key = norm(row?.course_name);
    if (!key) return;
    const existing = courseGroups.get(key) || { courseName: String(row?.course_name || ""), rows: [] };
    existing.rows.push(row);
    courseGroups.set(key, existing);
  });

  out.coursesTotal = courseGroups.size;
  courseGroups.forEach((group) => {
    let courseDone = group.rows.length > 0;
    group.rows.forEach((row) => {
      out.subjectsTotal += 1;
      const classCount = Math.max(1, Number(row?.class_count || 1));
      const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
      let subjectDone = true;
      for (let i = 1; i <= classCount; i += 1) {
        const topicNode = getTopicNode(group.courseName, row?.subject_name, `Class ${i}`);
        const hasClass = Boolean(topicNode?.class_study_first_date);
        const hasVideo = hasVideoForTopic(topicNode);
        const hasNotes = hasNotesForTopic(topicNode);
        const revDone = revisionCountFromTopic(topicNode);

        out.classesTotal += 1;
        out.classVideosTotal += 1;
        out.classNotesTotal += 1;
        out.classRevisionsTotal += requiredRevisions;

        if (hasVideo) out.classVideosDone += 1;
        if (hasNotes) out.classNotesDone += 1;
        out.classRevisionsDone += Math.min(revDone, requiredRevisions);
        out.classVideoItems.push({
          course: group.courseName,
          subject: String(row?.subject_name || ""),
          classNo: i,
          done: hasVideo,
        });

        if (hasClass && hasVideo && hasNotes && revDone >= requiredRevisions) {
          out.classesDone += 1;
        } else {
          subjectDone = false;
        }
      }
      if (subjectDone) out.subjectsDone += 1;
      else courseDone = false;
    });
    if (courseDone) out.coursesDone += 1;
  });

  books.forEach((row) => {
    out.booksTotal += 1;
    const chapterCount = Math.max(1, Number(row?.chapter_count || 1));
    const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
    const examName = `Book: ${String(row?.book_name || "").trim()}`;
    const subjectName = String(row?.book_name || "").trim();
    let bookDone = true;
    for (let i = 1; i <= chapterCount; i += 1) {
      const topicNode = getTopicNode(examName, subjectName, `Chapter ${i}`);
      const hasRead = Boolean(topicNode?.class_study_first_date);
      const hasNotes = hasNotesForTopic(topicNode);
      const revDone = revisionCountFromTopic(topicNode);

      out.chaptersTotal += 1;
      out.chapterNotesTotal += 1;
      out.chapterRevisionsTotal += requiredRevisions;
      if (hasNotes) out.chapterNotesDone += 1;
      out.chapterRevisionsDone += Math.min(revDone, requiredRevisions);
      if (hasRead) out.chaptersDone += 1;
      if (!(hasRead && hasNotes && revDone >= requiredRevisions)) bookDone = false;
    }
    if (bookDone) out.booksDone += 1;
  });

  randomRows.forEach((row) => {
    out.randomTotal += 1;
    const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
    const needsNotes = Boolean(row?.notes_required ?? true);
    const examName = `Random: ${String(row?.source || "").trim()}`;
    const subjectName = String(row?.source || "").trim();
    const topicName = String(row?.topic_name || "").trim();
    const topicNode = getTopicNode(examName, subjectName, topicName);
    const hasRead = Boolean(topicNode?.class_study_first_date);
    const hasNotes = hasNotesForTopic(topicNode);
    const revDone = revisionCountFromTopic(topicNode);

    if (needsNotes) {
      out.randomNotesTotal += 1;
      if (hasNotes) out.randomNotesDone += 1;
    }
    out.randomRevisionsTotal += requiredRevisions;
    out.randomRevisionsDone += Math.min(revDone, requiredRevisions);
    if (hasRead && (!needsNotes || hasNotes) && revDone >= requiredRevisions) out.randomDone += 1;
  });

  tests.forEach((row) => {
    out.testRowsTotal += 1;
    const totalTests = Math.max(1, Number(row?.number_of_tests || 1));
    const requiredRevisions = Math.max(0, Number(row?.revisions || 0));
    out.testsGivenTotal += totalTests;
    out.testsAnalysisTotal += totalTests;
    out.testRevisionsTotal += totalTests * requiredRevisions;

    let rowDone = true;
    for (let i = 1; i <= totalTests; i += 1) {
      const slot = findTestSlot(row?.source, i, row?.test_name);
      const given = Boolean(slot?.test_given_date);
      const analysis = Boolean(slot?.analysis_done_date);
      const revOne = Boolean(slot?.revision_date);
      const revTwo = Boolean(slot?.second_revision_date);
      const revDone = (revOne ? 1 : 0) + (revTwo ? 1 : 0);
      if (given) out.testsGivenDone += 1;
      if (analysis) out.testsAnalysisDone += 1;
      out.testRevisionsDone += Math.min(revDone, requiredRevisions);
      if (!(given && analysis && revDone >= requiredRevisions)) rowDone = false;
    }
    if (rowDone) out.testRowsDone += 1;
  });

  const ratios = [
    out.coursesTotal ? out.coursesDone / out.coursesTotal : 1,
    out.subjectsTotal ? out.subjectsDone / out.subjectsTotal : 1,
    out.classesTotal ? out.classesDone / out.classesTotal : 1,
    out.classVideosTotal ? out.classVideosDone / out.classVideosTotal : 1,
    out.classNotesTotal ? out.classNotesDone / out.classNotesTotal : 1,
    out.classRevisionsTotal ? out.classRevisionsDone / out.classRevisionsTotal : 1,
    out.booksTotal ? out.booksDone / out.booksTotal : 1,
    out.chaptersTotal ? out.chaptersDone / out.chaptersTotal : 1,
    out.chapterNotesTotal ? out.chapterNotesDone / out.chapterNotesTotal : 1,
    out.chapterRevisionsTotal ? out.chapterRevisionsDone / out.chapterRevisionsTotal : 1,
    out.randomTotal ? out.randomDone / out.randomTotal : 1,
    out.randomNotesTotal ? out.randomNotesDone / out.randomNotesTotal : 1,
    out.randomRevisionsTotal ? out.randomRevisionsDone / out.randomRevisionsTotal : 1,
    out.testRowsTotal ? out.testRowsDone / out.testRowsTotal : 1,
    out.testsGivenTotal ? out.testsGivenDone / out.testsGivenTotal : 1,
    out.testsAnalysisTotal ? out.testsAnalysisDone / out.testsAnalysisTotal : 1,
    out.testRevisionsTotal ? out.testRevisionsDone / out.testRevisionsTotal : 1,
  ];
  out.progressPercent = Math.round((ratios.reduce((acc, v) => acc + v, 0) / ratios.length) * 100);
  return out;
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(value) {
  const d = toDate(value);
  if (!d) return 999;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function classifyAxis(exam, subject, topic) {
  const text = `${exam || ""} ${subject || ""} ${topic || ""}`.toLowerCase();
  for (const axis of AXES) {
    const keys = AXIS_KEYWORDS[axis] || [];
    if (keys.some((k) => text.includes(k))) return axis;
  }
  return "Revision";
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildRecentDates(total) {
  const dates = [];
  const now = new Date();
  for (let i = total - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    dates.push(toIsoDate(d));
  }
  return dates;
}

function scoreMomentum(recent, previous) {
  if (previous === 0 && recent === 0) return { label: "Flat", cls: "stable" };
  if (previous === 0 && recent > 0) return { label: "Rising", cls: "rising" };
  const ratio = (recent - previous) / previous;
  if (ratio > 0.2) return { label: "Rising", cls: "rising" };
  if (ratio < -0.2) return { label: "Falling", cls: "falling" };
  return { label: "Stable", cls: "stable" };
}

function riskBand(value) {
  if (value >= 70) return { label: "High", cls: "high" };
  if (value >= 40) return { label: "Medium", cls: "medium" };
  return { label: "Low", cls: "low" };
}

function heatLevel(value) {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  if (value <= 4) return 3;
  return 4;
}

function radarPoints(values, radius, cx, cy) {
  const step = (Math.PI * 2) / values.length;
  return values
    .map((v, i) => {
      const angle = -Math.PI / 2 + i * step;
      const r = (Math.max(0, Math.min(100, v)) / 100) * radius;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      return `${x},${y}`;
    })
    .join(" ");
}

function emptyAxisStats() {
  return AXES.reduce((acc, axis) => {
    acc[axis] = { total: 0, covered: 0, retentionSum: 0, perfSum: 0, readiness: 0, coverage: 0, retention: 0, performance: 0 };
    return acc;
  }, {});
}

function buildMissionModel(syllabus, activityByDate, userId) {
  const exams = syllabus?.exams || [];
  const topics = [];
  const tests = [];

  exams.forEach((examNode) => {
    (examNode.subjects || []).forEach((subjectNode) => {
      (subjectNode.topics || []).forEach((topicNode) => {
        const classDate = topicNode.class_study_first_date || "";
        const firstRev = topicNode.first_revision_date || "";
        const secondRev = topicNode.second_revision_date || "";
        const lastTouch = secondRev || firstRev || classDate || "";
        const axis = classifyAxis(examNode.exam, subjectNode.subject, topicNode.topic);
        topics.push({
          exam: examNode.exam,
          subject: subjectNode.subject,
          topic: topicNode.topic,
          classDate,
          firstRev,
          secondRev,
          lastTouch,
          axis,
          recordings: topicNode.recordings || [],
        });
      });
    });

    (examNode.tests || []).forEach((sourceNode) => {
      (sourceNode.tests || []).forEach((t) => {
        tests.push({
          exam: examNode.exam,
          source: sourceNode.source,
          testNumber: t.test_number,
          testGivenDate: t.test_given_date,
          revisionDate: t.revision_date,
          secondRevisionDate: t.second_revision_date,
          note: t.note || "",
        });
      });
    });
  });

  const totalTopics = topics.length;
  const coveredTopics = topics.filter((t) => Boolean(t.classDate)).length;
  const firstRevisedTopics = topics.filter((t) => Boolean(t.firstRev)).length;

  const coverageScore = totalTopics ? Math.round((coveredTopics / totalTopics) * 100) : 0;
  const retentionTopicScores = topics.map((t) => {
    if (!t.classDate) return 0;
    let score = 35;
    if (t.firstRev) score += 35;
    if (t.secondRev) score += 20;
    const staleDays = daysSince(t.lastTouch);
    if (staleDays <= 5) score += 10;
    else if (staleDays <= 12) score += 5;
    return Math.min(100, score);
  });
  const retentionScore = retentionTopicScores.length
    ? Math.round(retentionTopicScores.reduce((a, b) => a + b, 0) / retentionTopicScores.length)
    : 0;

  const testsAttempted = tests.filter((t) => Boolean(t.testGivenDate)).length;
  const testsReviewed = tests.filter((t) => Boolean(t.revisionDate || t.secondRevisionDate)).length;
  const reviewRate = testsAttempted ? Math.round((testsReviewed / testsAttempted) * 100) : 0;

  const recentDates = buildRecentDates(14);
  const previousDates = buildRecentDates(28).slice(0, 14);
  const sumWindow = (dates, key) => dates.reduce((acc, d) => acc + ((activityByDate[d] || {})[key] || 0), 0);
  const recentTotal = sumWindow(recentDates, "study") + sumWindow(recentDates, "revision") + sumWindow(recentDates, "practice");
  const previousTotal = sumWindow(previousDates, "study") + sumWindow(previousDates, "revision") + sumWindow(previousDates, "practice");
  const momentum = scoreMomentum(recentTotal, previousTotal);

  const practiceConsistency = Math.round((recentDates.filter((d) => ((activityByDate[d] || {}).practice || 0) > 0).length / recentDates.length) * 100);
  const performanceScore = Math.round((reviewRate * 0.55) + (practiceConsistency * 0.25) + (Math.min(100, (testsAttempted / FULL_TEST_TARGET) * 100) * 0.2));

  const readiness = Math.round((coverageScore * 0.45) + (retentionScore * 0.35) + (performanceScore * 0.2));

  const leaks = [];
  topics.forEach((t) => {
    if (t.classDate && !t.firstRev && daysSince(t.classDate) >= 7) {
      leaks.push({ severity: "high", title: `${t.topic}`, detail: `${t.subject} not revised for ${daysSince(t.classDate)} days.` });
    } else if (t.firstRev && !t.secondRev && daysSince(t.firstRev) >= 15) {
      leaks.push({ severity: "medium", title: `${t.topic}`, detail: `Second revision pending for ${daysSince(t.firstRev)} days.` });
    }
  });

  const subjectTouch = {};
  topics.forEach((t) => {
    const key = t.subject;
    const days = daysSince(t.lastTouch);
    if (!(key in subjectTouch) || days < subjectTouch[key]) subjectTouch[key] = days;
  });
  Object.entries(subjectTouch)
    .filter(([, d]) => d >= 5)
    .slice(0, 3)
    .forEach(([subject, d]) => {
      leaks.push({ severity: d > 10 ? "high" : "medium", title: `${subject}`, detail: `Not touched for ${d} days.` });
    });

  if (testsAttempted === 0) {
    leaks.push({ severity: "high", title: "Mock Frequency", detail: "No tests attempted yet. Start recall pressure now." });
  }
  if (practiceConsistency < 35) {
    leaks.push({ severity: "medium", title: "Practice Drift", detail: "Practice rhythm is low in last 14 days." });
  }

  const riskValue = Math.min(100, (leaks.filter((l) => l.severity === "high").length * 18) + (leaks.filter((l) => l.severity === "medium").length * 9) + Math.max(0, 50 - retentionScore));
  const risk = riskBand(riskValue);

  const axisStats = emptyAxisStats();
  topics.forEach((t) => {
    const s = axisStats[t.axis];
    s.total += 1;
    if (t.classDate) s.covered += 1;
    let topicRetention = 0;
    if (t.classDate) topicRetention += 35;
    if (t.firstRev) topicRetention += 35;
    if (t.secondRev) topicRetention += 20;
    if (daysSince(t.lastTouch) <= 7) topicRetention += 10;
    s.retentionSum += Math.min(100, topicRetention);

    let perf = 20;
    if (t.firstRev) perf += 25;
    if (t.secondRev) perf += 30;
    if ((t.recordings || []).length > 0) perf += 15;
    if (daysSince(t.lastTouch) <= 7) perf += 10;
    s.perfSum += Math.min(100, perf);
  });

  AXES.forEach((axis) => {
    const s = axisStats[axis];
    if (s.total === 0) return;
    s.coverage = Math.round((s.covered / s.total) * 100);
    s.retention = Math.round(s.retentionSum / s.total);
    s.performance = Math.round(s.perfSum / s.total);
    s.readiness = Math.round((s.coverage + s.retention + s.performance) / 3);
  });

  const battleTasks = [];
  const weakestAxis = AXES
    .map((axis) => ({ axis, score: axisStats[axis].readiness }))
    .sort((a, b) => a.score - b.score)[0];
  battleTasks.push({ type: "Study", text: `Finish 2 focused blocks in ${weakestAxis?.axis || "core weak area"}.` });

  const oldestLeak = leaks[0];
  battleTasks.push({ type: "Revise", text: oldestLeak ? `Revise ${oldestLeak.title} today to stop memory decay.` : "Revise one old topic and close a pending cycle." });
  battleTasks.push({ type: "Test / Recall", text: userId === "divya" ? "Attempt 25 MCQs + 1 short test review." : "Close 1 ticket-style recall sprint + self-quiz." });

  const timeline = topics
    .map((t) => {
      const d = daysSince(t.lastTouch || t.classDate);
      let zone = "grey";
      if (t.classDate) {
        if (d <= 5) zone = "green";
        else if (d <= 12) zone = "yellow";
        else zone = "red";
      }
      return { key: `${t.subject}-${t.topic}`, label: t.topic, zone, days: d };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 80);

  const forumDone = tests.filter((t) => (t.source || "").toLowerCase().includes("sfg")).length;
  const cavaDone = topics.filter((t) => `${t.subject} ${t.topic}`.toLowerCase().includes("current affairs")).length;
  const fullTestsLeft = Math.max(0, FULL_TEST_TARGET - testsAttempted);
  const forumLeft = Math.max(0, FORUM_TARGET - forumDone);
  const cavaLeft = Math.max(0, CAVA_TARGET - cavaDone);
  const revisionDebt = Math.max(0, coveredTopics - firstRevisedTopics);

  const recentStudy = sumWindow(recentDates, "study");
  const prevStudy = sumWindow(previousDates, "study");
  const recentRev = sumWindow(recentDates, "revision");
  const prevRev = sumWindow(previousDates, "revision");
  const recentPractice = sumWindow(recentDates, "practice");
  const prevPractice = sumWindow(previousDates, "practice");

  const improved = [];
  const worsened = [];
  if (recentStudy > prevStudy) improved.push("Study rhythm"); else if (recentStudy < prevStudy) worsened.push("Study rhythm");
  if (recentRev > prevRev) improved.push("Revision discipline"); else if (recentRev < prevRev) worsened.push("Revision discipline");
  if (recentPractice > prevPractice) improved.push("Practice pressure"); else if (recentPractice < prevPractice) worsened.push("Practice pressure");

  const trajectoryScore = (readiness * 0.5) + (momentum.cls === "rising" ? 30 : momentum.cls === "stable" ? 15 : 0) - (riskValue * 0.25);
  const trajectory = trajectoryScore >= 65 ? "Closer to goal" : trajectoryScore >= 45 ? "Stable" : trajectoryScore >= 30 ? "Drifting" : "Falling behind";

  const csatAxis = axisStats.CSAT;
  const csatSafety = csatAxis.readiness >= 65 ? "Safe" : csatAxis.readiness >= 45 ? "Borderline" : "Unsafe";

  const identityDelta = readiness >= 65 && momentum.cls !== "falling"
    ? "Your behavior is matching a serious ranker pattern."
    : readiness >= 45
      ? "You are in recoverable zone, but revision consistency must harden."
      : "You are behaving more like a learner than a qualifier right now.";

  return {
    readiness,
    momentum,
    risk,
    riskText: leaks.slice(0, 2).map((l) => l.detail).join(" ") || "No major leakage detected.",
    axisStats,
    leaks: leaks.slice(0, 8),
    battleTasks,
    timeline,
    testsAttempted,
    reviewRate,
    performanceScore,
    fullTestsLeft,
    forumLeft,
    cavaLeft,
    revisionDebt,
    improved,
    worsened,
    trajectory,
    csatSafety,
    identityDelta,
  };
}

function ratioLabel(done, total) {
  return `${Number(done || 0)}/${Number(total || 0)}`;
}

export default function MissionControlPage() {
  const courseGroupIdRef = useRef(0);
  const nextCourseGroupId = () => {
    courseGroupIdRef.current += 1;
    return `course_group_${Date.now()}_${courseGroupIdRef.current}`;
  };
  const [userId, setUserId] = useState("kapil");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syllabus, setSyllabus] = useState({ exams: [] });
  const [activityByDate, setActivityByDate] = useState({});
  const [missionConfig, setMissionConfig] = useState(null);
  const [missionModalOpen, setMissionModalOpen] = useState(false);
  const [courseActionOpen, setCourseActionOpen] = useState("");
  const [missionSaving, setMissionSaving] = useState(false);
  const [classVideosModalOpen, setClassVideosModalOpen] = useState(false);
  const [missionDraft, setMissionDraft] = useState({
    title: "",
    target_date: "",
    status: "active",
    plan: {
      courses: [],
      books: [],
      random: [],
      tests: [],
    },
  });
  const [battleDone, setBattleDone] = useState([false, false, false]);

  const loadMission = async (nextUser = userId) => {
    if (!API_BASE_URL) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}/mission-control?user_id=${encodeURIComponent(nextUser)}&lookback_days=90`
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mission API failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setSyllabus(payload?.syllabus || { exams: [] });
      setActivityByDate(payload?.activity_by_date || {});
      setMissionConfig(payload?.mission || null);
      setBattleDone([false, false, false]);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      loadMission("kapil");
      return;
    }
    const initialUser = (window.localStorage.getItem(GLOBAL_USER_STORAGE_KEY) || "kapil").toLowerCase() === "divya" ? "divya" : "kapil";
    setUserId(initialUser);
    loadMission(initialUser);
    const onGlobalUser = (e) => {
      const nextUser = e?.detail?.userId === "divya" ? "divya" : "kapil";
      setUserId(nextUser);
      loadMission(nextUser);
    };
    window.addEventListener("global-user-change", onGlobalUser);
    return () => window.removeEventListener("global-user-change", onGlobalUser);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(""), NOTICE_TTL_MS);
    return () => clearTimeout(id);
  }, [error]);

  const mission = useMemo(() => buildMissionModel(syllabus, activityByDate, userId), [syllabus, activityByDate, userId]);

  useEffect(() => {
    if (!missionConfig) return;
    const rawCourses = Array.isArray(missionConfig?.plan?.courses) ? missionConfig.plan.courses : [];
    const groupByName = new Map();
    const coursesWithGroup = rawCourses.map((row) => {
      const existingGroup = String(row?.__group_id || "").trim();
      if (existingGroup) {
        return { ...row, __group_id: existingGroup };
      }
      const courseNameKey = String(row?.course_name || "").trim().toLowerCase();
      if (courseNameKey) {
        if (!groupByName.has(courseNameKey)) {
          groupByName.set(courseNameKey, nextCourseGroupId());
        }
        return { ...row, __group_id: groupByName.get(courseNameKey) };
      }
      return { ...row, __group_id: nextCourseGroupId() };
    });
    setMissionDraft({
      title: missionConfig.title || "",
      target_date: missionConfig.target_date || "",
      status: missionConfig.status || "active",
      plan: {
        courses: coursesWithGroup,
        books: Array.isArray(missionConfig?.plan?.books) ? missionConfig.plan.books : [],
        random: Array.isArray(missionConfig?.plan?.random) ? missionConfig.plan.random : [],
        tests: sanitizeMissionTestRows(missionConfig?.plan?.tests),
      },
    });
  }, [missionConfig]);

  const saveMission = async () => {
    if (!API_BASE_URL) return;
    setMissionSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/mission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          title: missionDraft.title,
          target_date: missionDraft.target_date,
          status: missionDraft.status,
          plan: {
            ...missionDraft.plan,
            tests: sanitizeMissionTestRows(missionDraft?.plan?.tests),
          },
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Mission save failed: ${res.status} ${txt}`);
      }
      const payload = await res.json();
      setMissionConfig(payload?.mission || null);
      setMissionModalOpen(false);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setMissionSaving(false);
    }
  };

  const battleProgress = Math.round((battleDone.filter(Boolean).length / 3) * 100);

  const radarValuesCoverage = AXES.map((axis) => mission.axisStats[axis]?.coverage || 0);
  const radarValuesRetention = AXES.map((axis) => mission.axisStats[axis]?.retention || 0);
  const radarValuesPerformance = AXES.map((axis) => mission.axisStats[axis]?.performance || 0);
  const planExecution = useMemo(
    () => buildMissionExecution(missionConfig?.plan, syllabus),
    [missionConfig?.plan, syllabus],
  );
  const classVideoItems = useMemo(
    () =>
      [...(planExecution.classVideoItems || [])].sort((a, b) => {
        const c = a.course.localeCompare(b.course);
        if (c !== 0) return c;
        const s = a.subject.localeCompare(b.subject);
        if (s !== 0) return s;
        return a.classNo - b.classNo;
      }),
    [planExecution.classVideoItems],
  );

  const recent45 = buildRecentDates(45);

  const identityCurrent = [
    mission.momentum.cls === "falling" ? "Irregular momentum" : "Momentum improving",
    mission.reviewRate < 50 ? "Weak test review loop" : "Tests are being reviewed",
    mission.revisionDebt > 20 ? "Revision debt growing" : "Revision debt controlled",
    mission.csatSafety === "Unsafe" ? "CSAT risk is high" : "CSAT trend is manageable",
  ];
  const identityTarget = [
    "Revises cyclically",
    "Attempts weekly tests",
    "Tracks and closes mistakes",
    "Protects CSAT safety buffer",
  ];
  const courseRows = Array.isArray(missionDraft?.plan?.courses) ? missionDraft.plan.courses : [];
  const courseGroups = (() => {
    const groups = [];
    const map = new Map();
    courseRows.forEach((row, idx) => {
      const courseName = String(row?.course_name || "");
      const trimmed = courseName.trim();
      const rowGroupId = String(row?.__group_id || "").trim();
      const key = rowGroupId || (trimmed ? `name:${trimmed.toLowerCase()}` : `empty:${idx}`);
      if (!map.has(key)) {
        map.set(key, { key, course_name: courseName, rowIndexes: [] });
        groups.push(map.get(key));
      }
      map.get(key).rowIndexes.push(idx);
    });
    return groups;
  })();

  return (
    <main className="app-shell mission-shell">
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />

      <header className="hero mission-hero">
        <MainMenu active="mission" />
        <ActivityInternalMenu active="mission" />
        <h1>UPSC Mission Control</h1>
        <p className="subtext">Distance to selection, leakage, daily battle and trajectory in one view.</p>

        {!API_BASE_URL ? <p className="api-state warn">Backend URL needed for Mission Control.</p> : null}
        {error ? <p className="api-state error">{error}</p> : null}
      </header>

      <section className="milestone-panel mission-controls">
        <div className="session-form-grid">
          <button className="btn-day" onClick={() => loadMission(userId)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Mission"}
          </button>
          <button className="btn-day secondary" onClick={() => setMissionModalOpen(true)} disabled={loading}>
            Set Mission
          </button>
        </div>

        {missionConfig ? (
          <div className="mission-status-grid" style={{ marginTop: 10 }}>
            <article className="mission-kpi"><h3>Mission</h3><p>{missionConfig.title || "UPSC Selection Mission"}</p></article>
            <article className="mission-kpi"><h3>Target Date</h3><p>{missionConfig.target_date || "-"}</p></article>
            <article className="mission-kpi"><h3>Status</h3><p>{missionConfig.status || "active"}</p></article>
            <article className="mission-kpi"><h3>Mission Progress</h3><p>{planExecution.progressPercent}%</p></article>
            <article className="mission-kpi"><h3>Courses</h3><p>{ratioLabel(planExecution.coursesDone, planExecution.coursesTotal)}</p></article>
            <article className="mission-kpi"><h3>Subjects</h3><p>{ratioLabel(planExecution.subjectsDone, planExecution.subjectsTotal)}</p></article>
            <article className="mission-kpi"><h3>Classes</h3><p>{ratioLabel(planExecution.classesDone, planExecution.classesTotal)}</p></article>
            <article className="mission-kpi">
              <h3>Class Videos</h3>
              <p>{ratioLabel(planExecution.classVideosDone, planExecution.classVideosTotal)}</p>
              <button
                type="button"
                className="btn-day secondary"
                style={{ marginTop: 8 }}
                onClick={() => setClassVideosModalOpen(true)}
              >
                View List
              </button>
            </article>
            <article className="mission-kpi"><h3>Class Notes</h3><p>{ratioLabel(planExecution.classNotesDone, planExecution.classNotesTotal)}</p></article>
            <article className="mission-kpi"><h3>Class Revisions</h3><p>{ratioLabel(planExecution.classRevisionsDone, planExecution.classRevisionsTotal)}</p></article>

            <article className="mission-kpi"><h3>Books</h3><p>{ratioLabel(planExecution.booksDone, planExecution.booksTotal)}</p></article>
            <article className="mission-kpi"><h3>Chapters</h3><p>{ratioLabel(planExecution.chaptersDone, planExecution.chaptersTotal)}</p></article>
            <article className="mission-kpi"><h3>Chapter Notes</h3><p>{ratioLabel(planExecution.chapterNotesDone, planExecution.chapterNotesTotal)}</p></article>
            <article className="mission-kpi"><h3>Chapter Revisions</h3><p>{ratioLabel(planExecution.chapterRevisionsDone, planExecution.chapterRevisionsTotal)}</p></article>

            <article className="mission-kpi"><h3>Random Topics</h3><p>{ratioLabel(planExecution.randomDone, planExecution.randomTotal)}</p></article>
            <article className="mission-kpi"><h3>Random Notes</h3><p>{ratioLabel(planExecution.randomNotesDone, planExecution.randomNotesTotal)}</p></article>
            <article className="mission-kpi"><h3>Random Revisions</h3><p>{ratioLabel(planExecution.randomRevisionsDone, planExecution.randomRevisionsTotal)}</p></article>

            <article className="mission-kpi"><h3>Test Rows</h3><p>{ratioLabel(planExecution.testRowsDone, planExecution.testRowsTotal)}</p></article>
            <article className="mission-kpi"><h3>Tests Given</h3><p>{ratioLabel(planExecution.testsGivenDone, planExecution.testsGivenTotal)}</p></article>
            <article className="mission-kpi"><h3>Tests Analysis</h3><p>{ratioLabel(planExecution.testsAnalysisDone, planExecution.testsAnalysisTotal)}</p></article>
            <article className="mission-kpi"><h3>Test Revisions</h3><p>{ratioLabel(planExecution.testRevisionsDone, planExecution.testRevisionsTotal)}</p></article>
          </div>
        ) : null}
      </section>

      <section className="milestone-panel summit-panel">
        <div className="summit-header">
          <div>
            <h2>Distance To UPSC Selection</h2>
            <p className="day-state">Am I moving closer to selection?</p>
          </div>
          <div className="trajectory-chip">{mission.trajectory}</div>
        </div>
        <div className="summit-metrics">
          <div><span>Readiness</span><strong>{mission.readiness} / 100</strong></div>
          <div><span>Momentum</span><strong className={`momentum-${mission.momentum.cls}`}>{mission.momentum.label}</strong></div>
          <div><span>Risk</span><strong className={`risk-${mission.risk.cls}`}>{mission.risk.label}</strong></div>
        </div>
        <div className="summit-path-wrap">
          <div className="summit-path">
            <div className="summit-fill" style={{ width: `${mission.readiness}%` }} />
            <div className={`summit-fog fog-${mission.risk.cls}`} />
            <div className="summit-marker" style={{ left: `${Math.max(4, mission.readiness)}%` }} />
            <div className="summit-goal">UPSC Selection</div>
          </div>
          <p className="risk-summary">Risk insight: {mission.riskText}</p>
        </div>
      </section>

      <section className="mission-main-grid">
        <article className="milestone-panel radar-panel">
          <h2>UPSC Wheel</h2>
          <p className="day-state">Coverage + Retention + Performance balance</p>
          <svg viewBox="0 0 340 340" className="radar-svg" role="img" aria-label="UPSC readiness radar">
            <circle cx="170" cy="170" r="120" className="radar-ring" />
            <circle cx="170" cy="170" r="90" className="radar-ring" />
            <circle cx="170" cy="170" r="60" className="radar-ring" />
            <circle cx="170" cy="170" r="30" className="radar-ring" />
            <polygon points={radarPoints(radarValuesCoverage, 120, 170, 170)} className="radar-poly coverage" />
            <polygon points={radarPoints(radarValuesRetention, 120, 170, 170)} className="radar-poly retention" />
            <polygon points={radarPoints(radarValuesPerformance, 120, 170, 170)} className="radar-poly performance" />
          </svg>
          <div className="radar-legend">
            <span><i className="dot radar-dot-coverage" />Coverage</span>
            <span><i className="dot radar-dot-retention" />Retention</span>
            <span><i className="dot radar-dot-performance" />Performance</span>
          </div>
          <div className="axis-mini-grid">
            {AXES.map((axis) => (
              <div key={axis} className="axis-mini-card">
                <strong>{axis}</strong>
                <div className="axis-bars">
                  <span style={{ width: `${mission.axisStats[axis]?.coverage || 0}%` }} className="bar coverage" />
                  <span style={{ width: `${mission.axisStats[axis]?.retention || 0}%` }} className="bar retention" />
                  <span style={{ width: `${mission.axisStats[axis]?.performance || 0}%` }} className="bar performance" />
                </div>
              </div>
            ))}
          </div>
        </article>

        <aside className="mission-side-stack">
          <article className="milestone-panel leak-panel">
            <h2>Danger Zone</h2>
            <p className="day-state">What is slipping out of control?</p>
            <div className="leak-list">
              {mission.leaks.length === 0 ? <p className="day-state">No major leaks detected. Keep consistency alive.</p> : mission.leaks.map((leak, idx) => (
                <div key={`${leak.title}-${idx}`} className={`leak-card ${leak.severity}`}>
                  <h4>{leak.title}</h4>
                  <p>{leak.detail}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="milestone-panel battle-panel">
            <h2>Today’s Battle Card</h2>
            <p className="day-state">What should I do today?</p>
            <div className="battle-list">
              {mission.battleTasks.map((task, idx) => (
                <button
                  key={`${task.type}-${idx}`}
                  className={`battle-task ${battleDone[idx] ? "done" : ""}`}
                  onClick={() => setBattleDone((prev) => prev.map((v, i) => (i === idx ? !v : v)))}
                >
                  <span className="battle-type">{task.type}</span>
                  <span>{task.text}</span>
                </button>
              ))}
            </div>
            <div className="battle-progress">
              <div className="battle-progress-fill" style={{ width: `${battleProgress}%` }} />
            </div>
            <p className="day-state">Mission completion: {battleProgress}%</p>
          </article>
        </aside>
      </section>

      <section className="mission-lower-grid">
        <article className="milestone-panel">
          <h2>Revision Decay Timeline</h2>
          <p className="day-state">Green recent, yellow due, red fading, grey untouched.</p>
          <div className="decay-strip">
            {mission.timeline.map((item) => (
              <div key={item.key} className={`decay-block ${item.zone}`} title={`${item.label} • ${item.days} days`} />
            ))}
          </div>
        </article>

        <article className="milestone-panel">
          <h2>Test Performance Story</h2>
          <p className="day-state">Effort-output relationship, not marks only.</p>
          <div className="story-grid">
            <div className="story-kpi"><span>Tests attempted</span><strong>{mission.testsAttempted}</strong></div>
            <div className="story-kpi"><span>Review completion</span><strong>{mission.reviewRate}%</strong></div>
            <div className="story-kpi"><span>Performance index</span><strong>{mission.performanceScore}</strong></div>
            <div className="story-kpi"><span>CSAT safety</span><strong>{mission.csatSafety}</strong></div>
          </div>
          <div className="river-chart">
            <div className="river-flow green" style={{ width: `${Math.max(8, mission.performanceScore)}%` }} />
            <div className="river-flow red" style={{ width: `${Math.max(5, 100 - mission.reviewRate)}%` }} />
            <div className="river-stones" style={{ width: `${Math.max(5, mission.revisionDebt)}%` }} />
          </div>
          <div className="river-labels">
            <span>Green: growth</span>
            <span>Red: careless/missed review</span>
            <span>Dark: repeated weak zones</span>
          </div>
        </article>

        <article className="milestone-panel">
          <h2>Consistency Heatmaps</h2>
          <p className="day-state">Study vs Revision vs Practice balance.</p>
          <div className="heatmap-group">
            {["study", "revision", "practice"].map((kind) => (
              <div key={kind} className="heatmap-row">
                <strong>{kind[0].toUpperCase() + kind.slice(1)}</strong>
                <div className="heatmap-grid">
                  {recent45.map((date) => {
                    const v = (activityByDate[date] || {})[kind] || 0;
                    return <span key={`${kind}-${date}`} className={`heat-cell level-${heatLevel(v)}`} title={`${date}: ${v}`} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mission-lower-grid">
        <article className="milestone-panel">
          <h2>Identity Reflection</h2>
          <p className="day-state">How different am I from the person who will clear UPSC?</p>
          <div className="identity-grid">
            <div>
              <h4>Current You</h4>
              <ul>
                {identityCurrent.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h4>Clearing You</h4>
              <ul>
                {identityTarget.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <p className="identity-delta">{mission.identityDelta}</p>
        </article>

        <article className="milestone-panel">
          <h2>Weekly Trajectory</h2>
          <div className="trajectory-status">{mission.trajectory}</div>
          <div className="trajectory-cols">
            <div>
              <h4>What Improved</h4>
              <ul>
                {(mission.improved.length ? mission.improved : ["No clear improvement this week"]).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <h4>What Worsened</h4>
              <ul>
                {(mission.worsened.length ? mission.worsened : ["No major decline this week"]).map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <h4>One Correction</h4>
              <p>
                {mission.worsened.includes("Revision discipline")
                  ? "Lock 2 fixed revision blocks daily before new study."
                  : mission.worsened.includes("Practice pressure")
                    ? "Add one timed recall/test block every day for 14 days."
                    : "Keep the current tempo and protect review backlog at zero."}
              </p>
            </div>
          </div>
        </article>

        <article className="milestone-panel projection-panel">
          <h2>14-Day Projection</h2>
          <p className="day-state">What happens if you continue like this?</p>
          <ul>
            <li>Likely readiness after 14 days: <strong>{Math.min(100, mission.readiness + (mission.momentum.cls === "rising" ? 8 : mission.momentum.cls === "stable" ? 3 : -5))}</strong></li>
            <li>Topics entering forgetting zone: <strong>{mission.timeline.filter((t) => t.zone === "red").length}</strong></li>
            <li>Expected revision debt drift: <strong>{mission.momentum.cls === "falling" ? "+6 topics" : mission.momentum.cls === "stable" ? "+2 topics" : "-3 topics"}</strong></li>
            <li>Mock readiness outlook: <strong>{mission.testsAttempted >= 8 ? "Recoverable" : "At risk"}</strong></li>
          </ul>
        </article>
      </section>

      {missionModalOpen ? (
        <div className="task-modal-overlay" onClick={() => setMissionModalOpen(false)}>
          <div className="task-modal" onClick={(e) => { e.stopPropagation(); setCourseActionOpen(""); }}>
            <h3>Set Mission</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              Saved values are loaded for edit.
            </p>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label>
                <strong>Mission Title</strong>
                <input
                  className="task-select"
                  placeholder="Mission Title (e.g. UPSC Selection Mission)"
                  value={missionDraft.title}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, title: e.target.value }))}
                />
              </label>
              <label>
                <strong>Target Date</strong>
                <input
                  className="task-select"
                  type="date"
                  value={missionDraft.target_date}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, target_date: e.target.value }))}
                />
              </label>
              <label>
                <strong>Status</strong>
                <select
                  className="task-select"
                  value={missionDraft.status}
                  onChange={(e) => setMissionDraft((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </label>
            </div>
            <h4 style={{ marginBottom: 8 }}>Course Plan</h4>
            <p className="day-state" style={{ marginTop: 0 }}>
              Add one course, then add multiple subjects under it. Backend will store each subject as a separate row.
            </p>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              {courseGroups.map((group, gidx) => (
                <div key={group.key} className="content-modal-card" style={{ borderRadius: 12, padding: 12 }}>
                  <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
                    <small>Course</small>
                    <small>Subject</small>
                    <small>Classes</small>
                    <small>Revisions</small>
                    <small>Action</small>
                  </div>
                  {group.rowIndexes.map((rowIdx, idxInGroup) => {
                    const row = courseRows[rowIdx] || {};
                    const isFirstRow = idxInGroup === 0;
                    return (
                      <div key={`course-${rowIdx}`} className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}>
                        {isFirstRow ? (
                          <input
                            className="task-select"
                            placeholder="Course"
                            value={group.course_name || ""}
                            onChange={(e) =>
                              setMissionDraft((prev) => {
                                const list = [...(prev.plan.courses || [])];
                                group.rowIndexes.forEach((i) => {
                                  list[i] = { ...list[i], course_name: e.target.value };
                                });
                                return { ...prev, plan: { ...prev.plan, courses: list } };
                              })
                            }
                          />
                        ) : (
                          <div />
                        )}
                        <input
                          className="task-select"
                          placeholder="Subject"
                          value={row.subject_name || ""}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], subject_name: e.target.value };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <input
                          className="task-select"
                          type="number"
                          min={1}
                          placeholder="Classes"
                          value={row.class_count ?? 1}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], class_count: Number(e.target.value || 1) };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <input
                          className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <div style={{ position: "relative" }}>
                          <button
                            className="btn-day secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              const key = `${group.key}:${rowIdx}`;
                              setCourseActionOpen((prev) => (prev === key ? "" : key));
                            }}
                          >
                            ...
                          </button>
                          {courseActionOpen === `${group.key}:${rowIdx}` ? (
                            <div
                              className="content-row-actions-menu"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: "calc(100% + 4px)",
                                zIndex: 40,
                                minWidth: 170,
                                padding: 6,
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.16)",
                                background: "rgba(15, 22, 40, 0.98)",
                                boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="content-row-action danger"
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  border: "none",
                                  background: "transparent",
                                  color: "#fda4af",
                                  fontWeight: 700,
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  cursor: "pointer",
                                }}
                                onClick={() => {
                                  setMissionDraft((prev) => {
                                    const list = [...(prev.plan.courses || [])];
                                    list.splice(rowIdx, 1);
                                    return { ...prev, plan: { ...prev.plan, courses: list } };
                                  });
                                  setCourseActionOpen("");
                                }}
                              >
                                Remove Subject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    className="btn-day secondary"
                    style={{ width: "100%" }}
                    onClick={() =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.courses || [])];
                        const sample = list[group.rowIndexes[0]] || {};
                        list.push({
                          course_name: sample.course_name || "",
                          subject_name: "",
                          class_count: Number(sample.class_count || 1),
                          revision_count: Math.min(5, Number(sample.revision_count || 1)),
                          __group_id: sample.__group_id || nextCourseGroupId(),
                        });
                        return { ...prev, plan: { ...prev.plan, courses: list } };
                      })
                    }
                  >
                    + Add Subject
                  </button>
                </div>
              ))}
              <button
                className="btn-day secondary"
                style={{ width: "100%" }}
                onClick={() =>
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      courses: [
                        ...(prev.plan.courses || []),
                        { course_name: "", subject_name: "", class_count: 1, revision_count: 1, __group_id: nextCourseGroupId() },
                      ],
                    },
                  }))
                }
              >
                + Add Course
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Book Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", opacity: 0.8 }}>
                <small>Book Name</small>
                <small>Chapters</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.books || []).map((row, idx) => (
                <div key={`book-${idx}`} className="session-form-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}>
                  <input
                    className="task-select"
                    placeholder="Book name"
                    value={row.book_name || ""}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.books || [])];
                        list[idx] = { ...list[idx], book_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, books: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={1}
                    placeholder="Chapters"
                    value={row.chapter_count ?? 1}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.books || [])];
                        list[idx] = { ...list[idx], chapter_count: Number(e.target.value || 1) };
                        return { ...prev, plan: { ...prev.plan, books: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.books || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, books: list } };
                            })
                          }
                        />
                  <button
                    className="btn-day secondary"
                    onClick={() =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.books || [])];
                        list.splice(idx, 1);
                        return { ...prev, plan: { ...prev.plan, books: list } };
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() =>
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      books: [...(prev.plan.books || []), { book_name: "", chapter_count: 1, revision_count: 1 }],
                    },
                  }))
                }
              >
                + Add Book
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Random Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr auto", opacity: 0.8 }}>
                <small>Source</small>
                <small>Topic</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.random || []).map((row, idx) => (
                <div key={`random-${idx}`} className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr auto" }}>
                  <input
                    className="task-select"
                    placeholder="Source"
                    value={row.source || ""}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.random || [])];
                        list[idx] = { ...list[idx], source: e.target.value };
                        return { ...prev, plan: { ...prev.plan, random: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    placeholder="Topic name"
                    value={row.topic_name || ""}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.random || [])];
                        list[idx] = { ...list[idx], topic_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, random: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                          type="number"
                          min={0}
                          max={5}
                          placeholder="Revisions"
                          value={row.revision_count ?? 1}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.random || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, random: list } };
                            })
                          }
                        />
                  <button
                    className="btn-day secondary"
                    onClick={() =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.random || [])];
                        list.splice(idx, 1);
                        return { ...prev, plan: { ...prev.plan, random: list } };
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() =>
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      random: [...(prev.plan.random || []), { source: "", topic_name: "", revision_count: 1 }],
                    },
                  }))
                }
              >
                + Add Random Topic
              </button>
            </div>
            <h4 style={{ marginBottom: 8, marginTop: 12 }}>Test Plan</h4>
            <div className="session-form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <p className="day-state" style={{ marginTop: 0 }}>
                `Given` and `Analysis` are automatic defaults from `No. Tests`.
              </p>
              <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto", opacity: 0.8 }}>
                <small>Test</small>
                <small>Source</small>
                <small>No. Tests</small>
                <small>Revisions</small>
                <small>Action</small>
              </div>
              {(missionDraft.plan.tests || []).map((row, idx) => (
                <div key={`test-${idx}`} className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}>
                  <input
                    className="task-select"
                    placeholder="Test"
                    value={row.test_name || ""}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], test_name: e.target.value };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    placeholder="Source"
                    value={row.source || ""}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], source: e.target.value };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={1}
                    placeholder="No. Tests"
                    value={row.number_of_tests ?? 1}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], number_of_tests: Number(e.target.value || 1) };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <input
                    className="task-select"
                    type="number"
                    min={0}
                    max={5}
                    placeholder="Revisions"
                    value={row.revisions ?? 0}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], revisions: Math.min(5, Number(e.target.value || 0)) };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <button
                    className="btn-day secondary"
                    onClick={() =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list.splice(idx, 1);
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() =>
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      tests: [
                        ...(prev.plan.tests || []),
                        {
                          test_name: "",
                          source: "",
                          number_of_tests: 1,
                          revisions: 0,
                        },
                      ],
                    },
                  }))
                }
              >
                + Add Test Plan
              </button>
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setMissionModalOpen(false)} disabled={missionSaving}>
                Cancel
              </button>
              <button className="btn-day" onClick={saveMission} disabled={missionSaving}>
                {missionSaving ? "Saving..." : "Save Mission"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {classVideosModalOpen ? (
        <div className="task-modal-overlay" onClick={() => setClassVideosModalOpen(false)}>
          <div className="task-modal" style={{ maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3>Class Video Status</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              Course - Subject - Class No - Status
            </p>
            <div className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 80px", opacity: 0.8 }}>
              <small>Course</small>
              <small>Subject</small>
              <small>Class</small>
              <small>Status</small>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {classVideoItems.length === 0 ? (
                <p className="day-state">No planned classes found in mission.</p>
              ) : (
                classVideoItems.map((item, idx) => (
                  <div key={`${item.course}-${item.subject}-${item.classNo}-${idx}`} className="session-form-grid" style={{ gridTemplateColumns: "2fr 2fr 1fr 80px" }}>
                    <span>{item.course}</span>
                    <span>{item.subject}</span>
                    <span>{`Class ${item.classNo}`}</span>
                    <strong>{item.done ? "✔" : "✖"}</strong>
                  </div>
                ))
              )}
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={() => setClassVideosModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
