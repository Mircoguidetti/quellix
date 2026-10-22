/** A realistic lab guideline used by the tests (written for Ormes, not a real customer's). */
export const KITCHEN_SPEC = `Egocentric Kitchen Data: Recording Guidelines v3

Task: Load dirty dishes into the dishwasher and close the door.

Steps:
1. Open the dishwasher door.
2. Place plates and glasses in the racks.
3. Close the door.

Final state: the dishwasher door is closed with all items inside.

Camera and file
- Record in landscape orientation with a head-mounted camera.
- Minimum resolution 1920x1080, at least 30 fps.
- Each video must be at least 2 minutes long and no longer than 10 minutes.
- Audio is not required.

Hands
- Both hands must be visible in frame at least 90% of the time while manipulating objects.

Quality
- Avoid blur: no more than 5% of the video may be blurry.
- No idle time longer than 3 seconds.
- Do not stage the task; work naturally.

Privacy
- No faces of other people may appear.
- Keep phone and computer screens out of view; do not record screens.
- Documents with names should be avoided.

Submissions
- Never resubmit the same video or a copy of a previous one.`;
