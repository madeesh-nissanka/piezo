# Example agent session (captured from a real run)

Server: `PIEZO_PORT=7496 node bin/piezo.js serve`. Demo solver: `examples/fake_solver.py`. Output below is unedited except that long JSON is wrapped.

## 1. Start a run
```
POST http://127.0.0.1:7496/runs  {"adapter":"python","input":"fake_solver.py","timeout_s":30}
{"id":"run_1791588179269_5p7sub"}
```

## 2. Poll status while it runs
```
GET /runs/run_1791588179269_5p7sub
{"exitCode": null, "lineCount": 28, "eventCount": 28} last progress: {'step': '27', 'residual': '7.22e-04'}
```

## 3. Final status
```
GET /runs/run_1791588179269_5p7sub
{
    "id": "run_1791588179269_5p7sub",
    "startTime": 1791588179323,
    "endTime": 1791588183076,
    "exitCode": 0,
    "signal": null,
    "timedOut": false,
    "cancelled": false,
    "lineCount": 32,
    "summary": {
        "lastProgress": {
            "t": 1791588182931,
            "line_no": 31,
            "type": "progress",
            "name": "progress",
            "fields": {
                "step": "30",
                "residual": "7.57e-04"
            },
            "text": "step 30 residual 7.57e-04"
        },
        "warningCount": 1,
        "errorCount": 0,
        "converged": true
    },
    "eventCount": 32
}
```

## 4. Non-progress events
```
GET /runs/run_1791588179269_5p7sub/events?since=0
16 warning WARNING: line search backtracked
32 converged Converged in 30 steps
```

## 5. Tail of the log
```
GET /runs/run_1791588179269_5p7sub/log?tail=3
30 step 29 residual 3.48e-04
31 step 30 residual 7.57e-04
32 Converged in 30 steps
```

## 6. Cancel a slow run
```
POST /runs/run_1791588193554_7vzpoi/cancel
{"cancelled":true}
{'signal': 'SIGTERM', 'cancelled': True, 'exitCode': None}
```

## 7. cwd outside the workspace root is refused
```
{"error":"cwd must be inside workspace root"}
```
