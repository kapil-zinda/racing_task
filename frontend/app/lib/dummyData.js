import { buildRecentDates } from "./dateUtils";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const DUMMY_DATA_NOTICE =
  "Showing sample progress data so you can preview this view. Connect your mission to see your real numbers.";

export function buildDummyMission() {
  return {
    title: "UPSC Selection Mission",
    target_date: daysAgo(-180),
    status: "active",
    icon: "🎯",
    category: "Education",
    plan: {
      courses: [
        { course_name: "GS Foundation", subject_name: "Polity", class_count: 4, revision_count: 2 },
        { course_name: "GS Foundation", subject_name: "History", class_count: 3, revision_count: 2 },
      ],
      books: [{ book_name: "Laxmikanth", chapter_count: 4, revision_count: 1 }],
      random: [
        { source: "Current Affairs", topic_name: "Union Budget 2026", revision_count: 1, notes_required: true },
        { source: "Current Affairs", topic_name: "Foreign Policy Update", revision_count: 1, notes_required: true },
      ],
      tests: [{ source: "Mains Test Series", test_name: "Mock", number_of_tests: 5, revisions: 1 }],
    },
  };
}

export function buildDummyJourneys() {
  return [
    {
      id: "dummy-1",
      title: "UPSC Selection Mission",
      target_date: daysAgo(-180),
      status: "active",
      icon: "🎯",
      category: "General",
      plan: {
        structure: [
          {
            label: "GS Foundation",
            children: [
              { label: "Polity", children: [] },
              { label: "History", children: [] },
            ],
          },
          {
            label: "Books",
            children: [{ label: "Laxmikanth", children: [] }],
          },
          { label: "Current Affairs", children: [] },
        ],
      },
    },
  ];
}

export function buildDummySyllabus() {
  return {
    exams: [
      {
        exam: "GS Foundation",
        subjects: [
          {
            subject: "Polity",
            topics: [
              {
                topic: "Class 1",
                class_study_first_date: daysAgo(22),
                first_revision_date: daysAgo(17),
                second_revision_date: daysAgo(8),
                revision_dates: [daysAgo(17), daysAgo(8)],
                note_dates: [daysAgo(22)],
                recordings: [{ media_types: ["video"] }],
              },
              {
                topic: "Class 2",
                class_study_first_date: daysAgo(19),
                first_revision_date: daysAgo(12),
                revision_dates: [daysAgo(12)],
                note_dates: [daysAgo(19)],
              },
              {
                topic: "Class 3",
                class_study_first_date: daysAgo(9),
                note_dates: [daysAgo(9)],
              },
              { topic: "Class 4" },
            ],
          },
          {
            subject: "History",
            topics: [
              {
                topic: "Class 1",
                class_study_first_date: daysAgo(24),
                first_revision_date: daysAgo(15),
                revision_dates: [daysAgo(15)],
                note_dates: [daysAgo(24)],
              },
              {
                topic: "Class 2",
                class_study_first_date: daysAgo(6),
                note_dates: [daysAgo(6)],
              },
              { topic: "Class 3" },
            ],
          },
        ],
        tests: [],
      },
      {
        exam: "Book: Laxmikanth",
        subjects: [
          {
            subject: "Laxmikanth",
            topics: [
              {
                topic: "Chapter 1",
                class_study_first_date: daysAgo(20),
                first_revision_date: daysAgo(11),
                revision_dates: [daysAgo(11)],
                note_dates: [daysAgo(20)],
              },
              {
                topic: "Chapter 2",
                class_study_first_date: daysAgo(7),
                note_dates: [daysAgo(7)],
              },
              { topic: "Chapter 3" },
              { topic: "Chapter 4" },
            ],
          },
        ],
        tests: [],
      },
      {
        exam: "Random: Current Affairs",
        subjects: [
          {
            subject: "Current Affairs",
            topics: [
              {
                topic: "Union Budget 2026",
                class_study_first_date: daysAgo(5),
                note_dates: [daysAgo(5)],
              },
              {
                topic: "Foreign Policy Update",
                class_study_first_date: daysAgo(2),
              },
            ],
          },
        ],
        tests: [
          {
            source: "Mains Test Series",
            tests: [
              { test_number: "1", test_name: "Mock", test_given_date: daysAgo(18), analysis_done_date: daysAgo(16), revision_date: daysAgo(10) },
              { test_number: "2", test_name: "Mock", test_given_date: daysAgo(11), analysis_done_date: daysAgo(9) },
              { test_number: "3", test_name: "Mock", test_given_date: daysAgo(4) },
              { test_number: "4", test_name: "Mock" },
              { test_number: "5", test_name: "Mock" },
            ],
          },
        ],
      },
    ],
  };
}

export function buildDummyActivity() {
  const dates = buildRecentDates(45);
  const studyDays = new Set([22, 19, 9, 24, 6, 20, 7, 5, 2, 1, 0].map((n) => daysAgo(n)));
  const revisionDays = new Set([17, 12, 15, 11, 8, 3].map((n) => daysAgo(n)));
  const practiceDays = new Set([18, 11, 4, 1].map((n) => daysAgo(n)));
  const activity = {};
  dates.forEach((date) => {
    activity[date] = {
      study: studyDays.has(date) ? 1 : 0,
      revision: revisionDays.has(date) ? 1 : 0,
      practice: practiceDays.has(date) ? 1 : 0,
    };
  });
  return activity;
}

export function buildDummyMissionControl() {
  return {
    syllabus: buildDummySyllabus(),
    activity_by_date: buildDummyActivity(),
    mission: buildDummyMission(),
  };
}
