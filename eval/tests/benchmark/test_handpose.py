import numpy as np
import pytest

from quellix_eval.benchmark import handpose as hp

K = np.array([[500.0, 0, 448], [0, 500.0, 252], [0, 0, 1]])
W, H = 896, 504
M = np.array([[0, 0, 1, 0], [-1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=float)


def world_from_cam(cam_xyz: np.ndarray) -> np.ndarray:
    """With an identity camera pose, AXIS_TRANSFORM @ p = cam, so p = M @ cam."""
    homo = np.vstack([cam_xyz, np.ones((1, cam_xyz.shape[1]))])
    return (M @ homo)[:3]


def hand_at(u: float, v: float, z: float = 0.5, spread: float = 0.03) -> np.ndarray:
    """26 joints around pixel (u, v) at depth z, in world coordinates."""
    rng = np.random.default_rng(int(u + v))
    x = (u - 448) * z / 500 + rng.uniform(-spread, spread, hp.JOINTS)
    y = (v - 252) * z / 500 + rng.uniform(-spread, spread, hp.JOINTS)
    return world_from_cam(np.vstack([x, y, np.full(hp.JOINTS, z)]))


def hand_row(frame: int, t: int, joints_world: np.ndarray, valid: bool = True) -> str:
    mats = np.tile(np.eye(4), (hp.JOINTS, 1, 1))
    mats[:, :3, 3] = joints_world.T
    flags = [1.0 if valid else 0.0] * 26 + [1.0] * 26
    vals = [frame, t, 1.0, *mats.reshape(-1).tolist(), *flags]
    return "\t".join(map(str, vals))


def test_projection_matches_the_pinhole_model():
    p = hp.project(hand_at(300, 200, spread=0), np.eye(4), K)
    assert p[:, 0] == pytest.approx(300) and p[:, 1] == pytest.approx(200)
    assert p[:, 2] == pytest.approx(0.5)


@pytest.mark.parametrize("u,v,inside", [(448, 300, True), (20, 300, False), (448, 495, False),
                                         (880, 30, False)])
def test_fully_visible_needs_every_joint_in_the_frame(u, v, inside):
    assert hp.fully_visible(hand_at(u, v), np.eye(4), K, W, H) is inside


def test_hand_behind_the_camera_is_not_visible():
    behind = world_from_cam(np.vstack([np.zeros(26), np.zeros(26), -np.ones(26)]))
    assert not hp.fully_visible(behind, np.eye(4), K, W, H)


def test_parsing_and_frame_visibility_with_timing():
    start = 1_000_000_000
    rows_l, rows_r, pose = [], [], []
    for i in range(10):
        t = start + i * 1_000_000            # 10 fps
        left = hand_at(300, 300) if i < 6 else hand_at(5, 300)       # leaves at frame 6
        rows_l.append(hand_row(i, t, left))
        rows_r.append(hand_row(i, t, hand_at(600, 300), valid=i != 2))  # untracked at frame 2
        pose.append("\t".join(map(str, [i, t, *np.eye(4).reshape(-1)])))
    ts, poses = hp.parse_pose_sync("\n".join(pose))
    k, w, h = hp.parse_intrinsics("\t".join(map(str, [*K.reshape(-1), W, H])))
    assert (w, h) == (W, H) and np.allclose(k, K)
    v = hp.visibility(hp.parse_hand("\n".join(rows_l)), hp.parse_hand("\n".join(rows_r)),
                      ts, poses, k, w, h, hp.parse_mp4_start(f"{start}\n{start + 10**7}"))
    assert v.t_s.tolist() == pytest.approx([i / 10 for i in range(10)])
    assert v.left.tolist() == [True] * 6 + [False] * 4
    assert v.right.tolist() == [True, True, False] + [True] * 7
    ratio, n = hp.both_ratio(v, 0.0, 1.0, [(0.0, 0.45), (0.5, 0.95)])
    assert n == 10 - 0 and ratio == pytest.approx(5 / 10)   # frames 0,1,3,4,5 have both
    assert hp.both_ratio(v, 0.0, 1.0, []) == (None, 0)


@pytest.mark.parametrize("ratio,label", [(None, "unknown"), (0.9, "pass"), (0.85, "pass"),
                                         (0.8, "unknown"), (0.75, "fail"), (0.1, "fail")])
def test_labels_leave_a_band_around_the_threshold(ratio, label):
    assert hp.label_from_ratio(ratio) == label
