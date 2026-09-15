#[cfg(windows)]
fn run() -> lost_codex_theme::codex::error::Result<()> {
    use lost_codex_theme::codex::{
        css_safety, detector,
        error::Error,
        injector,
        profiles::DEFAULT,
        session::{open_normally, CodexSession},
    };
    use std::time::Duration;
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("contract") if args.len() == 1 => {
            println!(
                "{}",
                serde_json::json!({"profile": DEFAULT,
                "bridge": lost_codex_theme::codex::dom_bridge::SOURCE, "testCss": injector::TEST_CSS,
                "nativeAppearance": lost_codex_theme::codex::dom_bridge::APPEARANCE_SOURCE,
                "limits": { "generatedCssBytes": css_safety::MAX_GENERATED, "customCssBytes": css_safety::MAX_CUSTOM }})
            );
        }
        Some("validate-css") if args.len() == 1 => {
            use std::io::Read;
            let mut css = String::new();
            std::io::stdin()
                .take((css_safety::MAX_GENERATED + 1) as u64)
                .read_to_string(&mut css)?;
            css_safety::validate(&css, false)?;
            println!(
                "{}",
                serde_json::json!({ "valid": true, "bytes": css.len() })
            );
        }
        Some("render-css") if args.len() == 1 => {
            use std::io::Read;
            let mut css = String::new();
            std::io::stdin()
                .take((css_safety::MAX_GENERATED + 1) as u64)
                .read_to_string(&mut css)?;
            css_safety::validate(&css, false)?;
            let rendered = injector::theme_css(&DEFAULT, &css);
            css_safety::validate(&rendered, false)?;
            print!("{rendered}");
        }
        Some("detect") if args.len() == 1 => {
            let installation = detector::detect()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "installation": installation, "running_pids": installation.running_pids()?,
                    "profile": DEFAULT.id, "compatibility": "not-yet-verified"
                }))?
            );
        }
        Some("run") if args.len() == 1 || (args.len() == 2 && args[1] == "--isolated") => {
            let isolated = args.len() == 2;
            let mut session = CodexSession::launch(isolated)?;
            println!(
                "Started isolated test process {}. Existing Codex is preserved: {}.",
                session.process_id(),
                session.preserved_existing
            );
            println!("Test data directory: {}", session.profile_path.display());
            let outcome: Result<(), Error> = (|| {
                let mut client = session.connect(Duration::from_secs(25))?;
                println!("PASS: loopback owner, browser identity, main renderer, profile anchors.");
                session.apply_test(&mut client)?;
                session.apply_test(&mut client)?;
                println!("PASS: repeated apply and computed test outline.");
                std::thread::sleep(Duration::from_secs(2));
                injector::soft_restore(&mut client, &DEFAULT)?;
                println!("PASS: soft restore.");
                Ok(())
            })();
            // Report cleanup independently. Never turn a partial result into a successful PoC.
            session.full_restore()?;
            println!("PASS: owned process tree stopped and debug port closed.");
            if !session.preserved_existing && !isolated {
                open_normally()?;
                println!("Normal Codex launch requested without debugging arguments.");
            }
            outcome?;
            println!("AUTOMATED CHECKS PASSED. Normal chat interaction still requires manual acceptance.");
        }
        Some("--help") | None => {
            println!("LostCodexTheme Phase 0\n\n  codex_poc detect\n  codex_poc run\n  codex_poc run --isolated\n\nrun refuses to close existing Codex. --isolated preserves it and tests a separate profile.\nThe owned test process is closed after every run, including errors. No installation files are modified.");
        }
        _ => return Err(Error::Safety("unknown command; use --help".into())),
    }
    Ok(())
}

fn main() {
    #[cfg(windows)]
    if let Err(error) = run() {
        eprintln!("Phase 0 NOT PASSED: {error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    {
        eprintln!("Phase 0 requires Windows.");
        std::process::exit(1);
    }
}
