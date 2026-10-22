"""Quellix task library: did the person complete the rubric's task, and when did each step happen.

Pipeline: frames (about 1 fps) and the rubric's steps / final state are embedded in a shared
image-text space (SigLIP 2) -> per-frame step similarities -> in-order step alignment
(`align`) -> completion features (`features`) -> calibrated head (`head`) -> three-way answer
with abstention (`decide`). Ambiguous cases answer `completed: null`, which the worker turns
into `review`: never an accept on doubt.
"""

__version__ = "0.1.0"
