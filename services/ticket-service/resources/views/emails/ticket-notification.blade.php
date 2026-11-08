<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ $notificationTitle }}</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; color: #1e293b; line-height: 1.6; }
        .wrapper { width: 100%; max-width: 600px; margin: 30px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background-color: #252578; color: #ffffff; padding: 24px 28px; text-align: left; }
        .header h1 { margin: 0; font-size: 19px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em; }
        .header p { margin: 6px 0 0 0; font-size: 12px; color: #cbd5e1; }
        .content { padding: 28px; background-color: #ffffff; color: #1e293b; }
        .message { font-size: 14px; color: #1e293b; margin: 0 0 20px 0; line-height: 1.6; }
        .details-box { background-color: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 20px 0; }
        .details-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .details-table td { padding: 10px 0; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        .details-table tr:last-child td { border-bottom: none; }
        .label { width: 130px; font-weight: 700; color: #1e293b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
        .value { color: #1e293b; font-weight: 600; font-size: 13px; }
        .action-area { margin-top: 28px; text-align: left; }
        .btn { display: inline-block; background-color: #252578; color: #ffffff !important; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.01em; box-shadow: 0 2px 4px rgba(37, 37, 120, 0.2); }
        .btn:hover { background-color: #1a1a59; }
        .footer { padding: 20px 28px; background-color: #f8f9fa; border-top: 1px solid #e2e8f0; font-size: 11px; color: #8d8b8f; text-align: left; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <h1>{{ $notificationTitle }}</h1>
            <p>SBSI Enterprise Ticketing System</p>
        </div>
        <div class="content">
            <p class="message">{{ $notificationMessage }}</p>

            <div class="details-box">
                <table class="details-table">
                    <tr>
                        <td class="label">Ticket Ref</td>
                        <td class="value" style="color: #252578; font-weight: 700;">{{ $ticketRef }}</td>
                    </tr>
                    <tr>
                        <td class="label">Subject</td>
                        <td class="value">{{ $ticketTitle }}</td>
                    </tr>
                    <tr>
                        <td class="label">Category</td>
                        <td class="value">{{ $category }}</td>
                    </tr>
                    <tr>
                        <td class="label">Priority</td>
                        <td class="value">{{ $priority }}</td>
                    </tr>
                </table>
            </div>

            <div class="action-area">
                <a href="{{ $ticketLink }}" class="btn" target="_blank" style="display: inline-block; background-color: #252578; color: #ffffff !important; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-size: 14px; font-weight: 700;">View Ticket Details</a>
            </div>
        </div>
        <div class="footer">
            <p style="margin: 0;">This is an automated notification from SBSI Enterprise Ticketing System. Please do not reply directly to this email.</p>
        </div>
    </div>
</body>
</html>
