<?php

return [
    // How fresh an employee heartbeat must be (in seconds) to count as Online.
    'online_window_seconds' => (int) env('PRESENCE_ONLINE_WINDOW_SECONDS', 90),
];
