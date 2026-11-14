import unittest

from lifemate.scoring import calls_match, matched_count, score_sample, summarize, token_f1

FUZZY = {"sms.send": frozenset({"content"}), "ride.book": frozenset({"pickup", "dropoff"})}


def call(name, **arguments):
    return {"name": name, "arguments": arguments}


class ScoringTest(unittest.TestCase):
    def test_token_f1_lowercase_nfc_and_punctuation(self):
        decomposed = "Hà Nội"   # "Hà Nội" in NFD
        self.assertEqual(token_f1("HÀ NỘI!", decomposed), 1.0)
        self.assertAlmostEqual(token_f1("về nhà ngay", "về nhà"), 0.8)

    def test_fuzzy_threshold_is_strict(self):
        gold = call("sms.send", contact_id="c1", content="a b c d e")
        self.assertTrue(calls_match(call("sms.send", contact_id="c1", content="a b c"), gold, FUZZY))    # F1 = 0.75
        self.assertFalse(calls_match(call("sms.send", contact_id="c1", content="a b"), gold, FUZZY))    # F1 = 4/7 < 0.6
        self.assertFalse(calls_match(call("sms.send", contact_id="c1"), gold, FUZZY))                    # missing fuzzy arg
        self.assertFalse(calls_match(call("sms.send", contact_id="c2", content="a b c d e"), gold, FUZZY))

    def test_non_fuzzy_arguments_must_be_identical(self):
        gold = call("smart_home.climate_set", device_id="ac", temperature=26)
        self.assertTrue(calls_match(call("smart_home.climate_set", device_id="ac", temperature=26.0), gold, FUZZY))
        self.assertFalse(calls_match(call("smart_home.climate_set", device_id="AC", temperature=26), gold, FUZZY))
        self.assertFalse(calls_match(call("smart_home.climate_set", device_id="ac"), gold, FUZZY))
        self.assertFalse(calls_match(call("smart_home.climate_set", device_id="ac", temperature=26, mode="cool"), gold, FUZZY))

    def test_matching_is_one_to_one_and_order_free(self):
        gold = [call("a.read"), call("a.write", x=1)]
        self.assertEqual(matched_count([call("a.write", x=1), call("a.read")], gold, FUZZY), 2)
        self.assertEqual(matched_count([call("a.read"), call("a.read")], gold, FUZZY), 1)

    def test_maximum_matching_not_greedy(self):
        # p0 fits both gold calls, p1 only the first; greedy p0->g0 would leave p1 unmatched.
        gold = [call("sms.send", content="xin chào bạn"), call("sms.send", content="xin chào bạn nhé")]
        predicted = [call("sms.send", content="xin chào bạn nhé"), call("sms.send", content="xin chào bạn")]
        self.assertEqual(matched_count(predicted, gold, FUZZY), 2)

    def test_sample_formula(self):
        gold = [call("a.read"), call("a.write", x=1)]
        full = score_sample(gold, "h", gold, "h", FUZZY)
        self.assertEqual(full["score"], 1.0)
        extra = score_sample(gold + [call("a.read", q="z")], "h", gold, "h", FUZZY)   # P = 2/3, R = 1
        self.assertAlmostEqual(extra["score"], 0.8)
        wrong_hash = score_sample(gold, "h2", gold, "h", FUZZY)
        self.assertEqual((wrong_hash["score"], wrong_hash["f1_no_hash"]), (0.0, 1.0))
        none_matched = score_sample([call("b.x")], "h", gold, "h", FUZZY)
        self.assertEqual(none_matched["score"], 0.0)

    def test_empty_gold(self):
        self.assertEqual(score_sample([], "h", [], "h", FUZZY)["score"], 1.0)
        self.assertEqual(score_sample([call("a.read")], "h", [], "h", FUZZY)["score"], 0.0)

    def test_summary(self):
        gold = [call("a.read")]
        rows = {"s1": score_sample(gold, "h", gold, "h", FUZZY), "s2": score_sample([], "h", [], "h", FUZZY),
                "s3": score_sample(gold, "x", gold, "h", FUZZY), "s4": score_sample(gold + gold, "h", gold, "h", FUZZY)}
        summary = summarize(rows)
        self.assertAlmostEqual(summary["score"], 100 * (1 + 1 + 0 + 2 / 3) / 4)
        self.assertAlmostEqual(summary["f1_no_hash"], 100 * (1 + 1 + 1 + 2 / 3) / 4)
        self.assertEqual(summary["lost_to_hash"], 1)


if __name__ == "__main__":
    unittest.main()
