POINTS_MAP = {
    "new_class": 3,
    "revision": 2,
    "ticket_resolved": 4,
    "test_completed": 4,
}

ACTION_LABELS = {
    "new_class": "New Class",
    "revision": "Revision",
    "ticket_resolved": "Ticket Resolved",
    "test_completed": "Test Completed",
}

MILESTONES = [
    {"points": 20, "reward": "Coffee Treat"},
    {"points": 40, "reward": "Movie Night"},
    {"points": 70, "reward": "Dinner Out"},
    {"points": 100, "reward": "Weekend Mini Trip"},
]

PLAYERS = ("kapil", "divya")
MEDIA_TYPES = {"audio", "video", "screen", "attachment"}
RECORDER_MODE_MAP = {
    "time": [],
    "audio": ["audio"],
    "video": ["video"],
    "call": ["video", "screen"],
    "pdf_explainer": ["audio"],
    "uploader": [],
}
