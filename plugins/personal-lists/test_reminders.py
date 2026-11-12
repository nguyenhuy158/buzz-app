import unittest
from reminders import sync, due_tasks


class ReminderTests(unittest.TestCase):
    def test_sync_cancel_account_and_delivery(self):
        value = {"viewer": "a" * 64, "community": "wss://example.org", "tasks": [{"id": "one", "due": 200}]}
        state = sync({}, value, 100)
        self.assertEqual(due_tasks(state, 199), [])
        task = due_tasks(state, 200)[0]
        task["attempted"] = True
        self.assertEqual(due_tasks(sync(state, value, 201), 201), [])
        self.assertEqual(due_tasks(sync(state, {**value, "tasks": []}, 201), 201), [])
        self.assertEqual(sync(state, {"clear": True}, 201), {})
        other = sync(state, {**value, "viewer": "b" * 64, "tasks": []}, 201)
        self.assertEqual(due_tasks(other, 201), [])
        with self.assertRaises(ValueError):
            sync(state, {**value, "tasks": [{"id": "one", "due": True}]}, 201)


if __name__ == "__main__":
    unittest.main()
