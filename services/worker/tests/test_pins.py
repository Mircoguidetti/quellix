from quellix_worker import modal_app
from quellix_worker.checks import privacy


def test_yunet_is_pinned_to_a_commit_and_hash():
    for url in (privacy.YUNET_URL, modal_app.YUNET_URL):
        assert "/main/" not in url and privacy.YUNET_COMMIT in url
    assert privacy.YUNET_COMMIT == modal_app.YUNET_COMMIT and len(privacy.YUNET_COMMIT) == 40
    assert privacy.YUNET_SHA256 == modal_app.YUNET_SHA256 and len(privacy.YUNET_SHA256) == 64
