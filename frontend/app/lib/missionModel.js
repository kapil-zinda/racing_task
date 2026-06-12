import { buildRecentDates, daysSince } from "./dateUtils";
import { riskBand, scoreMomentum } from "./vizUtils";

export function norm(value) {
  return String(value || "").trim().toLowerCase();
}

export function revisionCountFromTopic(topicNode) {
  if (!topicNode || typeof topicNode !== "object") return 0;
  if (Array.isArray(topicNode.revision_dates) && topicNode.revision_dates.length > 0) {
    return topicNode.revision_dates.length;
  }
  let count = 0;
  if (topicNode.first_revision_date) count += 1;
  if (topicNode.second_revision_date) count += 1;
  return count;
}

export function hasVideoForTopic(topicNode) {
  // Product rule: class read/study entry in points means class video watched.
  if (topicNode?.class_study_first_date) return true;
  const recordings = Array.isArray(topicNode?.recordings) ? topicNode.recordings : [];
  return recordings.some((rec) => {
    const media = Array.isArray(rec?.media_types) ? rec.media_types : [];
    return media.includes("video") || media.includes("screen");
  });
}

export function hasNotesForTopic(topicNode) {
  const noteDates = Array.isArray(topicNode?.note_dates) ? topicNode.note_dates : [];
  if (noteDates.length > 0) return true;
  if (topicNode?.note_first_date) return true;
  return Array.isArray(topicNode?.notes) && topicNode.notes.length > 0;
}

export function ratioLabel(done, total) {
  return `${Number(done || 0)}/${Number(total || 0)}`;
}

export function buildMissionExecution(plan, syllabus) {
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

export function buildMissionModel(planExecution) {
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
  battleTasks.push({ type: "Test / Recall", text: "Close 1 ticket-style recall sprint + self-quiz." });

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
