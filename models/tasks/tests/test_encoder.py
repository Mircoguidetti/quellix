from types import SimpleNamespace

from quellix_tasks.encoder import _features


class _Tensor:
    def float(self):
        return self


def test_features_accepts_a_tensor_or_a_pooled_output():
    t = _Tensor()
    assert _features(t) is t                                   # transformers 4
    assert _features(SimpleNamespace(pooler_output=t)) is t    # transformers 5
