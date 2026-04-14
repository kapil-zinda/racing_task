"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MainMenu from "../components/MainMenu";
import ActivityInternalMenu from "../components/ActivityInternalMenu";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const NOTICE_TTL_MS = 15000;
const GLOBAL_USER_STORAGE_KEY = "global_user_id";
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
  // Product rule: class read/study entry in points means class video watched.
  if (topicNode?.class_study_first_date) return true;
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
    randomReadDone: 0,
    randomReadTotal: 0,
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
    testsCompleteDone: 0,
    testsCompleteTotal: 0,
    dimensions: [],
    courseItems: [],
    subjectItems: [],
    classItems: [],
    classVideoItems: [],
    classNotesItems: [],
    classRevisionItems: [],
    bookItems: [],
    chapterItems: [],
    chapterNotesItems: [],
    chapterRevisionItems: [],
    randomItems: [],
    randomNotesItems: [],
    randomRevisionItems: [],
    testRowItems: [],
    testGivenItems: [],
    testAnalysisItems: [],
    testRevisionItems: [],
    missionTopics: [],
    missionTestSlots: [],
  };

  const missionTopicMap = new Map();
  const upsertMissionTopic = (examName, subjectName, topicName, topicNode, axisName) => {
    const key = `${norm(examName)}||${norm(subjectName)}||${norm(topicName)}`;
    if (missionTopicMap.has(key)) return;
    const revisionDates = Array.isArray(topicNode?.revision_dates)
      ? topicNode.revision_dates.filter(Boolean)
      : [topicNode?.first_revision_date, topicNode?.second_revision_date, topicNode?.third_revision_date, topicNode?.fourth_revision_date, topicNode?.fifth_revision_date].filter(Boolean);
    missionTopicMap.set(key, {
      key,
      exam: String(examName || ""),
      subject: String(subjectName || ""),
      topic: String(topicName || ""),
      axis: String(axisName || "Randoms"),
      classDate: topicNode?.class_study_first_date || "",
      firstRev: topicNode?.first_revision_date || "",
      secondRev: topicNode?.second_revision_date || "",
      revisionDates,
      lastTouch: topicNode?.second_revision_date || topicNode?.first_revision_date || topicNode?.class_study_first_date || "",
      recordings: Array.isArray(topicNode?.recordings) ? topicNode.recordings : [],
    });
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
    let courseClassesTotal = 0;
    let courseClassVideosDone = 0;
    let courseClassNotesDone = 0;
    let courseClassRevisionsTotal = 0;
    let courseClassRevisionsDone = 0;
    let courseClassesDone = 0;
    let courseDone = group.rows.length > 0;
    group.rows.forEach((row) => {
      const subjectLabel = String(row?.subject_name || "");
      out.subjectsTotal += 1;
      const classCount = Math.max(1, Number(row?.class_count || 1));
      const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
      let subjectDone = true;
      for (let i = 1; i <= classCount; i += 1) {
        const examName = group.courseName;
        const subjectName = subjectLabel;
        const topicName = `Class ${i}`;
        const topicNode = getTopicNode(examName, subjectName, topicName);
        upsertMissionTopic(examName, subjectName, topicName, topicNode, "Courses");
        const hasClass = Boolean(topicNode?.class_study_first_date);
        const hasVideo = hasVideoForTopic(topicNode);
        const hasNotes = hasNotesForTopic(topicNode);
        const revDone = revisionCountFromTopic(topicNode);

        out.classesTotal += 1;
        out.classVideosTotal += 1;
        out.classNotesTotal += 1;
        out.classRevisionsTotal += requiredRevisions;
        courseClassesTotal += 1;
        courseClassRevisionsTotal += requiredRevisions;

        if (hasVideo) {
          out.classVideosDone += 1;
          courseClassVideosDone += 1;
        }
        if (hasNotes) {
          out.classNotesDone += 1;
          courseClassNotesDone += 1;
        }
        const cappedRev = Math.min(revDone, requiredRevisions);
        out.classRevisionsDone += cappedRev;
        courseClassRevisionsDone += cappedRev;
        out.classVideoItems.push({
          course: group.courseName,
          subject: subjectLabel,
          classNo: i,
          done: hasVideo,
        });
        out.classNotesItems.push({
          course: group.courseName,
          subject: subjectLabel,
          classNo: i,
          done: hasNotes,
        });
        out.classRevisionItems.push({
          course: group.courseName,
          subject: subjectLabel,
          classNo: i,
          done: revDone >= requiredRevisions,
          doneCount: Math.min(revDone, requiredRevisions),
          totalCount: requiredRevisions,
        });
        out.classItems.push({
          course: group.courseName,
          subject: subjectLabel,
          classNo: i,
          done: hasClass && hasVideo && hasNotes && revDone >= requiredRevisions,
        });

        if (hasClass && hasVideo && hasNotes && revDone >= requiredRevisions) {
          out.classesDone += 1;
          courseClassesDone += 1;
        } else {
          subjectDone = false;
        }
      }
      if (subjectDone) out.subjectsDone += 1;
      else courseDone = false;
      out.subjectItems.push({
        course: group.courseName,
        subject: subjectLabel,
        done: subjectDone,
      });
    });
    if (courseDone) out.coursesDone += 1;
    out.courseItems.push({
      course: group.courseName,
      done: courseDone,
    });
    out.dimensions.push({
      key: `course:${norm(group.courseName) || Math.random().toString(36).slice(2)}`,
      label: group.courseName || "Unnamed Course",
      kind: "course",
      coverageDone: courseClassVideosDone + courseClassNotesDone,
      coverageTotal: 2 * courseClassesTotal,
      retentionDone: courseClassRevisionsDone,
      retentionTotal: courseClassRevisionsTotal,
      performanceDone: courseClassesDone,
      performanceTotal: courseClassesTotal,
    });
  });

  books.forEach((row) => {
    const bookName = String(row?.book_name || "").trim();
    out.booksTotal += 1;
    const chapterCount = Math.max(1, Number(row?.chapter_count || 1));
    const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
    const examName = `Book: ${bookName}`;
    const subjectName = bookName;
    let bookDone = true;
    let chaptersDoneForBook = 0;
    let chapterNotesDoneForBook = 0;
    let chapterRevisionsDoneForBook = 0;
    for (let i = 1; i <= chapterCount; i += 1) {
      const topicName = `Chapter ${i}`;
      const topicNode = getTopicNode(examName, subjectName, topicName);
      upsertMissionTopic(examName, subjectName, topicName, topicNode, "Books");
      const hasRead = Boolean(topicNode?.class_study_first_date);
      const hasNotes = hasNotesForTopic(topicNode);
      const revDone = revisionCountFromTopic(topicNode);

      out.chaptersTotal += 1;
      out.chapterNotesTotal += 1;
      out.chapterRevisionsTotal += requiredRevisions;
      if (hasNotes) {
        out.chapterNotesDone += 1;
        chapterNotesDoneForBook += 1;
      }
      const cappedRev = Math.min(revDone, requiredRevisions);
      out.chapterRevisionsDone += cappedRev;
      chapterRevisionsDoneForBook += cappedRev;
      if (hasRead) {
        out.chaptersDone += 1;
        chaptersDoneForBook += 1;
      }
      out.chapterItems.push({
        book: bookName,
        chapterNo: i,
        done: hasRead,
      });
      out.chapterNotesItems.push({
        book: bookName,
        chapterNo: i,
        done: hasNotes,
      });
      out.chapterRevisionItems.push({
        book: bookName,
        chapterNo: i,
        done: revDone >= requiredRevisions,
        doneCount: Math.min(revDone, requiredRevisions),
        totalCount: requiredRevisions,
      });
      if (!(hasRead && hasNotes && revDone >= requiredRevisions)) bookDone = false;
    }
    if (bookDone) out.booksDone += 1;
    out.bookItems.push({
      book: bookName,
      done: bookDone,
    });
    out.dimensions.push({
      key: `book:${norm(bookName) || Math.random().toString(36).slice(2)}`,
      label: bookName || "Unnamed Book",
      kind: "book",
      coverageDone: chaptersDoneForBook + chapterNotesDoneForBook,
      coverageTotal: 2 * chapterCount,
      retentionDone: chapterRevisionsDoneForBook,
      retentionTotal: chapterCount * requiredRevisions,
      performanceDone: bookDone ? 1 : 0,
      performanceTotal: 1,
    });
  });

  randomRows.forEach((row) => {
    out.randomTotal += 1;
    const requiredRevisions = Math.max(0, Number(row?.revision_count || 0));
    const needsNotes = Boolean(row?.notes_required ?? true);
    const examName = `Random: ${String(row?.source || "").trim()}`;
    const subjectName = String(row?.source || "").trim();
    const topicName = String(row?.topic_name || "").trim();
    const topicNode = getTopicNode(examName, subjectName, topicName);
    upsertMissionTopic(examName, subjectName, topicName, topicNode, "Randoms");
    const hasRead = Boolean(topicNode?.class_study_first_date);
    const hasNotes = hasNotesForTopic(topicNode);
    const revDone = revisionCountFromTopic(topicNode);

    out.randomReadTotal += 1;
    if (hasRead) out.randomReadDone += 1;

    if (needsNotes) {
      out.randomNotesTotal += 1;
      if (hasNotes) out.randomNotesDone += 1;
    }
    out.randomRevisionsTotal += requiredRevisions;
    const cappedRev = Math.min(revDone, requiredRevisions);
    out.randomRevisionsDone += cappedRev;
    const randomComplete = hasRead && (!needsNotes || hasNotes) && revDone >= requiredRevisions;
    if (randomComplete) out.randomDone += 1;
    out.randomItems.push({
      source: subjectName,
      topic: topicName,
      done: randomComplete,
    });
    out.randomNotesItems.push({
      source: subjectName,
      topic: topicName,
      done: !needsNotes || hasNotes,
    });
    out.randomRevisionItems.push({
      source: subjectName,
      topic: topicName,
      done: revDone >= requiredRevisions,
      doneCount: cappedRev,
      totalCount: requiredRevisions,
    });
    out.dimensions.push({
      key: `random:${norm(subjectName)}:${norm(topicName) || Math.random().toString(36).slice(2)}`,
      label: `${subjectName || "Random"} - ${topicName || "Topic"}`,
      kind: "random",
      coverageDone: (hasRead ? 1 : 0) + ((needsNotes && hasNotes) || (!needsNotes) ? 1 : 0),
      coverageTotal: 2,
      retentionDone: cappedRev,
      retentionTotal: requiredRevisions,
      performanceDone: randomComplete ? 1 : 0,
      performanceTotal: 1,
    });
  });

  tests.forEach((row) => {
    out.testRowsTotal += 1;
    const totalTests = Math.max(1, Number(row?.number_of_tests || 1));
    const requiredRevisions = Math.max(0, Number(row?.revisions || 0));
    out.testsGivenTotal += totalTests;
    out.testsAnalysisTotal += totalTests;
    out.testRevisionsTotal += totalTests * requiredRevisions;

    let rowDone = true;
    let rowGivenDone = 0;
    let rowAnalysisDone = 0;
    let rowRevisionsDone = 0;
    let rowCompleteDone = 0;
    for (let i = 1; i <= totalTests; i += 1) {
      const slot = findTestSlot(row?.source, i, row?.test_name);
      const given = Boolean(slot?.test_given_date);
      const analysis = Boolean(slot?.analysis_done_date);
      const revOne = Boolean(slot?.revision_date);
      const revTwo = Boolean(slot?.second_revision_date);
      out.missionTestSlots.push({
        source: String(row?.source || ""),
        testName: String(row?.test_name || ""),
        testNumber: i,
        testGivenDate: slot?.test_given_date || "",
        analysisDoneDate: slot?.analysis_done_date || "",
        revisionDate: slot?.revision_date || "",
        secondRevisionDate: slot?.second_revision_date || "",
      });
      const revDone = (revOne ? 1 : 0) + (revTwo ? 1 : 0);
      const slotComplete = given && analysis && revDone >= requiredRevisions;
      if (given) {
        out.testsGivenDone += 1;
        rowGivenDone += 1;
      }
      if (analysis) {
        out.testsAnalysisDone += 1;
        rowAnalysisDone += 1;
      }
      const cappedRev = Math.min(revDone, requiredRevisions);
      out.testRevisionsDone += cappedRev;
      rowRevisionsDone += cappedRev;
      out.testsCompleteTotal += 1;
      if (slotComplete) {
        out.testsCompleteDone += 1;
        rowCompleteDone += 1;
      }
      out.testGivenItems.push({
        source: String(row?.source || ""),
        testName: String(row?.test_name || ""),
        testNumber: i,
        done: given,
      });
      out.testAnalysisItems.push({
        source: String(row?.source || ""),
        testName: String(row?.test_name || ""),
        testNumber: i,
        done: analysis,
      });
      out.testRevisionItems.push({
        source: String(row?.source || ""),
        testName: String(row?.test_name || ""),
        testNumber: i,
        done: revDone >= requiredRevisions,
        doneCount: Math.min(revDone, requiredRevisions),
        totalCount: requiredRevisions,
      });
      if (!(given && analysis && revDone >= requiredRevisions)) rowDone = false;
    }
    if (rowDone) out.testRowsDone += 1;
    out.testRowItems.push({
      source: String(row?.source || ""),
      testName: String(row?.test_name || ""),
      done: rowDone,
    });
    out.dimensions.push({
      key: `test:${norm(row?.source)}:${norm(row?.test_name)}:${totalTests}`,
      label: `${String(row?.source || "Test")} - ${String(row?.test_name || "Set")}`,
      kind: "test",
      coverageDone: rowGivenDone + rowAnalysisDone,
      coverageTotal: 2 * totalTests,
      retentionDone: rowRevisionsDone,
      retentionTotal: totalTests * requiredRevisions,
      performanceDone: rowCompleteDone,
      performanceTotal: totalTests,
    });
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
  out.missionTopics = Array.from(missionTopicMap.values());
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

function buildMissionModel(planExecution, userId) {
  const topics = Array.isArray(planExecution?.missionTopics) ? planExecution.missionTopics : [];
  const tests = Array.isArray(planExecution?.missionTestSlots) ? planExecution.missionTestSlots : [];
  const activityByDate = {};
  const bump = (dateStr, key) => {
    if (!dateStr) return;
    const d = String(dateStr).slice(0, 10);
    if (!d) return;
    if (!activityByDate[d]) activityByDate[d] = { study: 0, revision: 0, practice: 0 };
    activityByDate[d][key] += 1;
  };
  topics.forEach((t) => {
    bump(t.classDate, "study");
    (Array.isArray(t.revisionDates) ? t.revisionDates : []).forEach((d) => bump(d, "revision"));
  });
  tests.forEach((t) => {
    bump(t.testGivenDate, "practice");
  });
  const missionTotalTests = tests.length;
  const totalTopics = topics.length;
  const coveredTopics = topics.filter((t) => Boolean(t.classDate)).length;
  const firstRevisedTopics = topics.filter((t) => Boolean(t.firstRev)).length;
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
  const ratioPct = (done, total) => {
    if (!total || total <= 0) return null;
    return Math.round((Math.max(0, done) / total) * 100);
  };

  const avg = (values) => {
    const usable = values.filter((v) => typeof v === "number");
    if (usable.length === 0) return 0;
    return Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
  };

  const dimensionRows = Array.isArray(planExecution?.dimensions) ? planExecution.dimensions : [];
  const coverageScore = avg(dimensionRows.map((row) => ratioPct(row.coverageDone, row.coverageTotal)));
  const retentionScore = avg(dimensionRows.map((row) => ratioPct(row.retentionDone, row.retentionTotal)));
  const performanceScore = avg(dimensionRows.map((row) => ratioPct(row.performanceDone, row.performanceTotal)));
  const readiness = Math.round((coverageScore + retentionScore + performanceScore) / 3);

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

  if (missionTotalTests > 0 && testsAttempted === 0) {
    leaks.push({ severity: "high", title: "Mock Frequency", detail: "No tests attempted yet. Start recall pressure now." });
  }
  if (practiceConsistency < 35) {
    leaks.push({ severity: "medium", title: "Practice Drift", detail: "Practice rhythm is low in last 14 days." });
  }

  const riskValue = Math.min(100, (leaks.filter((l) => l.severity === "high").length * 18) + (leaks.filter((l) => l.severity === "medium").length * 9) + Math.max(0, 50 - retentionScore));
  const risk = riskBand(riskValue);

  const axisStats = {};
  const axes = dimensionRows.map((row, idx) => {
    const coverage = ratioPct(row.coverageDone, row.coverageTotal) || 0;
    const retention = ratioPct(row.retentionDone, row.retentionTotal) || 0;
    const performance = ratioPct(row.performanceDone, row.performanceTotal) || 0;
    const readinessRow = Math.round((coverage + retention + performance) / 3);
    const axisKey = String(row.label || `Dimension ${idx + 1}`);
    axisStats[axisKey] = {
      total: row.performanceTotal || 0,
      covered: row.coverageDone || 0,
      retentionSum: row.retentionDone || 0,
      perfSum: row.performanceDone || 0,
      coverage,
      retention,
      performance,
      readiness: readinessRow,
      kind: String(row.kind || ""),
    };
    return axisKey;
  });

  const battleTasks = [];
  const weakestAxis = axes
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

  const forumTotal = tests.filter((t) => (t.source || "").toLowerCase().includes("sfg")).length;
  const forumDone = tests.filter((t) => Boolean(t.testGivenDate) && (t.source || "").toLowerCase().includes("sfg")).length;
  const cavaTotal = topics.filter((t) => `${t.exam} ${t.subject} ${t.topic}`.toLowerCase().includes("current affairs")).length;
  const cavaDone = topics.filter((t) => Boolean(t.classDate) && `${t.exam} ${t.subject} ${t.topic}`.toLowerCase().includes("current affairs")).length;
  const fullTestsLeft = Math.max(0, missionTotalTests - testsAttempted);
  const forumLeft = Math.max(0, forumTotal - forumDone);
  const cavaLeft = Math.max(0, cavaTotal - cavaDone);
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

  const testAxes = axes.filter((axis) => axisStats[axis]?.kind === "test");
  const testsAxisReadiness = testAxes.length
    ? Math.round(testAxes.reduce((acc, axis) => acc + (axisStats[axis]?.readiness || 0), 0) / testAxes.length)
    : performanceScore;
  const csatSafety = testsAxisReadiness >= 65 ? "Safe" : testsAxisReadiness >= 45 ? "Borderline" : "Unsafe";

  const identityDelta = readiness >= 65 && momentum.cls !== "falling"
    ? "Your behavior is matching a serious ranker pattern."
    : readiness >= 45
      ? "You are in recoverable zone, but revision consistency must harden."
      : "You are behaving more like a learner than a qualifier right now.";

  return {
    readiness,
    axes,
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
  const [editableRows, setEditableRows] = useState({
    course: {},
    book: {},
    random: {},
    test: {},
  });
  const [missionSaving, setMissionSaving] = useState(false);
  const [metricModal, setMetricModal] = useState({
    open: false,
    title: "",
    subtitle: "",
    columns: [],
    rows: [],
  });
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
    setEditableRows({ course: {}, book: {}, random: {}, test: {} });
  }, [missionConfig]);

  const setRowEditable = (kind, idx, editable) => {
    setEditableRows((prev) => ({
      ...prev,
      [kind]: {
        ...(prev[kind] || {}),
        [idx]: Boolean(editable),
      },
    }));
  };

  const isRowEditable = (kind, idx) => Boolean(editableRows?.[kind]?.[idx]);

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

  const planExecution = useMemo(
    () => buildMissionExecution(missionConfig?.plan, syllabus),
    [missionConfig?.plan, syllabus],
  );
  const mission = useMemo(() => buildMissionModel(planExecution, userId), [planExecution, userId]);
  const wheelAxes = mission.axes?.length ? mission.axes : ["No Mission Dimension"];
  const radarValuesCoverage = wheelAxes.map((axis) => mission.axisStats[axis]?.coverage || 0);
  const radarValuesRetention = wheelAxes.map((axis) => mission.axisStats[axis]?.retention || 0);
  const radarValuesPerformance = wheelAxes.map((axis) => mission.axisStats[axis]?.performance || 0);
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
  const openMetricModal = (config) => {
    setMetricModal({
      open: true,
      title: config.title,
      subtitle: config.subtitle || "Done/Pending status list",
      columns: Array.isArray(config.columns) ? config.columns : [],
      rows: Array.isArray(config.rows) ? config.rows : [],
    });
  };
  const closeMetricModal = () => setMetricModal((prev) => ({ ...prev, open: false }));

  const metricCardConfigs = {
    courses: {
      title: "Course Status",
      columns: ["Course", "Status"],
      rows: (planExecution.courseItems || []).map((x) => [x.course, x.done ? "✔" : "✖"]),
    },
    subjects: {
      title: "Subject Status",
      columns: ["Course", "Subject", "Status"],
      rows: (planExecution.subjectItems || []).map((x) => [x.course, x.subject, x.done ? "✔" : "✖"]),
    },
    classes: {
      title: "Class Completion Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: (planExecution.classItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classVideos: {
      title: "Class Video Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: classVideoItems.map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classNotes: {
      title: "Class Notes Status",
      columns: ["Course", "Subject", "Class", "Status"],
      rows: (planExecution.classNotesItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, x.done ? "✔" : "✖"]),
    },
    classRevisions: {
      title: "Class Revision Status",
      columns: ["Course", "Subject", "Class", "Progress", "Status"],
      rows: (planExecution.classRevisionItems || []).map((x) => [x.course, x.subject, `Class ${x.classNo}`, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    books: {
      title: "Book Completion Status",
      columns: ["Book", "Status"],
      rows: (planExecution.bookItems || []).map((x) => [x.book, x.done ? "✔" : "✖"]),
    },
    chapters: {
      title: "Chapter Read Status",
      columns: ["Book", "Chapter", "Status"],
      rows: (planExecution.chapterItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, x.done ? "✔" : "✖"]),
    },
    chapterNotes: {
      title: "Chapter Notes Status",
      columns: ["Book", "Chapter", "Status"],
      rows: (planExecution.chapterNotesItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, x.done ? "✔" : "✖"]),
    },
    chapterRevisions: {
      title: "Chapter Revision Status",
      columns: ["Book", "Chapter", "Progress", "Status"],
      rows: (planExecution.chapterRevisionItems || []).map((x) => [x.book, `Chapter ${x.chapterNo}`, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    randomTopics: {
      title: "Random Topic Completion Status",
      columns: ["Source", "Topic", "Status"],
      rows: (planExecution.randomItems || []).map((x) => [x.source, x.topic, x.done ? "✔" : "✖"]),
    },
    randomNotes: {
      title: "Random Notes Status",
      columns: ["Source", "Topic", "Status"],
      rows: (planExecution.randomNotesItems || []).map((x) => [x.source, x.topic, x.done ? "✔" : "✖"]),
    },
    randomRevisions: {
      title: "Random Revision Status",
      columns: ["Source", "Topic", "Progress", "Status"],
      rows: (planExecution.randomRevisionItems || []).map((x) => [x.source, x.topic, `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
    testRows: {
      title: "Test Row Completion Status",
      columns: ["Source", "Test", "Status"],
      rows: (planExecution.testRowItems || []).map((x) => [x.source, x.testName, x.done ? "✔" : "✖"]),
    },
    testsGiven: {
      title: "Tests Given Status",
      columns: ["Source", "Test", "No.", "Status"],
      rows: (planExecution.testGivenItems || []).map((x) => [x.source, x.testName, String(x.testNumber), x.done ? "✔" : "✖"]),
    },
    testsAnalysis: {
      title: "Tests Analysis Status",
      columns: ["Source", "Test", "No.", "Status"],
      rows: (planExecution.testAnalysisItems || []).map((x) => [x.source, x.testName, String(x.testNumber), x.done ? "✔" : "✖"]),
    },
    testRevisions: {
      title: "Test Revision Status",
      columns: ["Source", "Test", "No.", "Progress", "Status"],
      rows: (planExecution.testRevisionItems || []).map((x) => [x.source, x.testName, String(x.testNumber), `${x.doneCount}/${x.totalCount}`, x.done ? "✔" : "✖"]),
    },
  };

  const recent45 = buildRecentDates(45);

  const identityCurrent = [
    mission.momentum.cls === "falling" ? "Irregular momentum" : "Momentum improving",
    mission.reviewRate < 50 ? "Weak test review loop" : "Tests are being reviewed",
    mission.revisionDebt > 20 ? "Revision debt growing" : "Revision debt controlled",
    mission.csatSafety === "Unsafe" ? "Test execution risk is high" : "Test execution trend is manageable",
  ];
  const identityTarget = [
    "Revises cyclically",
    "Attempts weekly tests",
    "Tracks and closes mistakes",
    "Protects test completion safety buffer",
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
            Edit Mission
          </button>
        </div>

        {missionConfig ? (
          <div className="mission-status-grid" style={{ marginTop: 10 }}>
            <article className="mission-kpi"><h3>Mission</h3><p>{missionConfig.title || "UPSC Selection Mission"}</p></article>
            <article className="mission-kpi"><h3>Target Date</h3><p>{missionConfig.target_date || "-"}</p></article>
            <article className="mission-kpi"><h3>Status</h3><p>{missionConfig.status || "active"}</p></article>
            <article className="mission-kpi"><h3>Mission Progress</h3><p>{planExecution.progressPercent}%</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.courses)}><h3>Courses</h3><p>{ratioLabel(planExecution.coursesDone, planExecution.coursesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.subjects)}><h3>Subjects</h3><p>{ratioLabel(planExecution.subjectsDone, planExecution.subjectsTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classes)}><h3>Classes</h3><p>{ratioLabel(planExecution.classesDone, planExecution.classesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classVideos)}><h3>Class Videos</h3><p>{ratioLabel(planExecution.classVideosDone, planExecution.classVideosTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classNotes)}><h3>Class Notes</h3><p>{ratioLabel(planExecution.classNotesDone, planExecution.classNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.classRevisions)}><h3>Class Revisions</h3><p>{ratioLabel(planExecution.classRevisionsDone, planExecution.classRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.books)}><h3>Books</h3><p>{ratioLabel(planExecution.booksDone, planExecution.booksTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapters)}><h3>Chapters</h3><p>{ratioLabel(planExecution.chaptersDone, planExecution.chaptersTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapterNotes)}><h3>Chapter Notes</h3><p>{ratioLabel(planExecution.chapterNotesDone, planExecution.chapterNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.chapterRevisions)}><h3>Chapter Revisions</h3><p>{ratioLabel(planExecution.chapterRevisionsDone, planExecution.chapterRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomTopics)}><h3>Random Topics</h3><p>{ratioLabel(planExecution.randomDone, planExecution.randomTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomNotes)}><h3>Random Notes</h3><p>{ratioLabel(planExecution.randomNotesDone, planExecution.randomNotesTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.randomRevisions)}><h3>Random Revisions</h3><p>{ratioLabel(planExecution.randomRevisionsDone, planExecution.randomRevisionsTotal)}</p></article>

            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testRows)}><h3>Test Rows</h3><p>{ratioLabel(planExecution.testRowsDone, planExecution.testRowsTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testsGiven)}><h3>Tests Given</h3><p>{ratioLabel(planExecution.testsGivenDone, planExecution.testsGivenTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testsAnalysis)}><h3>Tests Analysis</h3><p>{ratioLabel(planExecution.testsAnalysisDone, planExecution.testsAnalysisTotal)}</p></article>
            <article className="mission-kpi clickable" role="button" tabIndex={0} onClick={() => openMetricModal(metricCardConfigs.testRevisions)}><h3>Test Revisions</h3><p>{ratioLabel(planExecution.testRevisionsDone, planExecution.testRevisionsTotal)}</p></article>
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
            {wheelAxes.map((axis) => (
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
            <div className="story-kpi"><span>Tests safety</span><strong>{mission.csatSafety}</strong></div>
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
            <h3>Edit Mission</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              Saved values are loaded as read-only. Use item Action -&gt; Edit to modify.
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
                      <div
                        key={`course-${rowIdx}`}
                        className={`session-form-grid mission-plan-row ${isRowEditable("course", rowIdx) ? "is-editing" : "is-locked"}`}
                        style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
                      >
                        {isFirstRow ? (
                          <input
                            className="task-select"
                            placeholder="Course"
                            value={group.course_name || ""}
                            disabled={!isRowEditable("course", rowIdx)}
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
                          disabled={!isRowEditable("course", rowIdx)}
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
                          disabled={!isRowEditable("course", rowIdx)}
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
                          disabled={!isRowEditable("course", rowIdx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.courses || [])];
                              list[rowIdx] = { ...list[rowIdx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, courses: list } };
                            })
                          }
                        />
                        <div style={{ position: "relative" }}>
                          <span className={`mission-row-state ${isRowEditable("course", rowIdx) ? "editing" : "locked"}`}>
                            {isRowEditable("course", rowIdx) ? "Editing" : "Locked"}
                          </span>
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
                              {!isRowEditable("course", rowIdx) ? (
                                <button
                                  className="content-row-action"
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    background: "transparent",
                                    color: "#c7d2fe",
                                    fontWeight: 700,
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    setRowEditable("course", rowIdx, true);
                                    setCourseActionOpen("");
                                  }}
                                >
                                  Edit
                                </button>
                              ) : (
                                <button
                                  className="content-row-action"
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    border: "none",
                                    background: "transparent",
                                    color: "#86efac",
                                    fontWeight: 700,
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => {
                                    setRowEditable("course", rowIdx, false);
                                    setCourseActionOpen("");
                                  }}
                                >
                                  Done
                                </button>
                              )}
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
                                  setEditableRows((prev) => ({ ...prev, course: {} }));
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
                        const newIndex = list.length;
                        list.push({
                          course_name: sample.course_name || "",
                          subject_name: "",
                          class_count: Number(sample.class_count || 1),
                          revision_count: Math.min(5, Number(sample.revision_count || 1)),
                          __group_id: sample.__group_id || nextCourseGroupId(),
                        });
                        setTimeout(() => setRowEditable("course", newIndex, true), 0);
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
                onClick={() => {
                  const nextIndex = (missionDraft.plan.courses || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      courses: [
                        ...(prev.plan.courses || []),
                        { course_name: "", subject_name: "", class_count: 1, revision_count: 1, __group_id: nextCourseGroupId() },
                      ],
                    },
                  }));
                  setTimeout(() => setRowEditable("course", nextIndex, true), 0);
                }}
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
                <div
                  key={`book-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("book", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Book name"
                    value={row.book_name || ""}
                    disabled={!isRowEditable("book", idx)}
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
                    disabled={!isRowEditable("book", idx)}
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
                          disabled={!isRowEditable("book", idx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.books || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, books: list } };
                            })
                          }
                        />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `book:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `book:${idx}` ? (
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
                        {!isRowEditable("book", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("book", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("book", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
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
                              const list = [...(prev.plan.books || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, books: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, book: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.books || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      books: [...(prev.plan.books || []), { book_name: "", chapter_count: 1, revision_count: 1 }],
                    },
                  }));
                  setTimeout(() => setRowEditable("book", nextIndex, true), 0);
                }}
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
                <div
                  key={`random-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("random", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 2fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Source"
                    value={row.source || ""}
                    disabled={!isRowEditable("random", idx)}
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
                    disabled={!isRowEditable("random", idx)}
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
                          disabled={!isRowEditable("random", idx)}
                          onChange={(e) =>
                            setMissionDraft((prev) => {
                              const list = [...(prev.plan.random || [])];
                              list[idx] = { ...list[idx], revision_count: Math.min(5, Number(e.target.value || 0)) };
                              return { ...prev, plan: { ...prev.plan, random: list } };
                            })
                          }
                        />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `random:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `random:${idx}` ? (
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
                        {!isRowEditable("random", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("random", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("random", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
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
                              const list = [...(prev.plan.random || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, random: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, random: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.random || []).length;
                  setMissionDraft((prev) => ({
                    ...prev,
                    plan: {
                      ...prev.plan,
                      random: [...(prev.plan.random || []), { source: "", topic_name: "", revision_count: 1 }],
                    },
                  }));
                  setTimeout(() => setRowEditable("random", nextIndex, true), 0);
                }}
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
                <div
                  key={`test-${idx}`}
                  className={`session-form-grid mission-plan-row ${isRowEditable("test", idx) ? "is-editing" : "is-locked"}`}
                  style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr auto" }}
                >
                  <input
                    className="task-select"
                    placeholder="Test"
                    value={row.test_name || ""}
                    disabled={!isRowEditable("test", idx)}
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
                    disabled={!isRowEditable("test", idx)}
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
                    disabled={!isRowEditable("test", idx)}
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
                    disabled={!isRowEditable("test", idx)}
                    onChange={(e) =>
                      setMissionDraft((prev) => {
                        const list = [...(prev.plan.tests || [])];
                        list[idx] = { ...list[idx], revisions: Math.min(5, Number(e.target.value || 0)) };
                        return { ...prev, plan: { ...prev.plan, tests: list } };
                      })
                    }
                  />
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-day secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        const key = `test:${idx}`;
                        setCourseActionOpen((prev) => (prev === key ? "" : key));
                      }}
                    >
                      ...
                    </button>
                    {courseActionOpen === `test:${idx}` ? (
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
                        {!isRowEditable("test", idx) ? (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#c7d2fe",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("test", idx, true);
                              setCourseActionOpen("");
                            }}
                          >
                            Edit
                          </button>
                        ) : (
                          <button
                            className="content-row-action"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: "#86efac",
                              fontWeight: 700,
                              padding: "8px 10px",
                              borderRadius: 8,
                              cursor: "pointer",
                            }}
                            onClick={() => {
                              setRowEditable("test", idx, false);
                              setCourseActionOpen("");
                            }}
                          >
                            Done
                          </button>
                        )}
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
                              const list = [...(prev.plan.tests || [])];
                              list.splice(idx, 1);
                              return { ...prev, plan: { ...prev.plan, tests: list } };
                            });
                            setEditableRows((prev) => ({ ...prev, test: {} }));
                            setCourseActionOpen("");
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                className="btn-day secondary"
                onClick={() => {
                  const nextIndex = (missionDraft.plan.tests || []).length;
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
                  }));
                  setTimeout(() => setRowEditable("test", nextIndex, true), 0);
                }}
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
      {metricModal.open ? (
        <div className="task-modal-overlay" onClick={closeMetricModal}>
          <div className="task-modal" style={{ maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3>{metricModal.title}</h3>
            <p className="day-state" style={{ marginTop: 0 }}>
              {metricModal.subtitle}
            </p>
            <div
              className="session-form-grid"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, metricModal.columns.length)}, minmax(0, 1fr))`, opacity: 0.8 }}
            >
              {metricModal.columns.map((col) => <small key={col}>{col}</small>)}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {!metricModal.rows.length ? (
                <p className="day-state">No planned items found for this metric.</p>
              ) : (
                metricModal.rows.map((row, idx) => (
                  <div
                    key={`${metricModal.title}-${idx}`}
                    className="session-form-grid"
                    style={{ gridTemplateColumns: `repeat(${Math.max(1, metricModal.columns.length)}, minmax(0, 1fr))` }}
                  >
                    {row.map((cell, cIdx) => <span key={`${idx}-${cIdx}`}>{cell}</span>)}
                  </div>
                ))
              )}
            </div>
            <div className="task-modal-actions">
              <button className="btn-day secondary" onClick={closeMetricModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
