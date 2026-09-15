use super::error::{Error, Result};
use cssparser::{ParseError, Parser, ParserInput, Token};

pub const MAX_GENERATED: usize = 16 * 1024 * 1024;
pub const MAX_CUSTOM: usize = 262144;

fn allowed_url(value: &str) -> bool {
    [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .any(|prefix| {
        value.strip_prefix(prefix).is_some_and(|body| {
            !body.is_empty()
                && body
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"+/=".contains(&c))
        })
    })
}

fn scan<'i>(
    parser: &mut Parser<'i, '_>,
    depth: usize,
) -> std::result::Result<(), ParseError<'i, String>> {
    if depth > 32 {
        return Err(parser.new_custom_error("CSS nesting exceeds the limit".to_owned()));
    }
    while !parser.is_exhausted() {
        let token = parser.next_including_whitespace_and_comments()?.clone();
        match token {
            Token::AtKeyword(name)
                if name.eq_ignore_ascii_case("import")
                    || name.eq_ignore_ascii_case("font-face") =>
            {
                return Err(parser.new_custom_error(
                    "CSS imports and embedded font rules are not supported".to_owned(),
                ));
            }
            Token::UnquotedUrl(value) => {
                if !allowed_url(&value) {
                    return Err(
                        parser.new_custom_error("CSS may not load external resources".to_owned())
                    );
                }
            }
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                parser.parse_nested_block(|nested| {
                    let value = nested.expect_string_cloned()?;
                    if !allowed_url(&value) {
                        return Err(nested
                            .new_custom_error("CSS may not load external resources".to_owned()));
                    }
                    nested.expect_exhausted()?;
                    Ok(())
                })?;
            }
            Token::Function(name) if name.eq_ignore_ascii_case("expression") => {
                return Err(parser.new_custom_error("Executable CSS is not supported".to_owned()));
            }
            Token::Function(name)
                if ["image-set", "-webkit-image-set", "image", "src"]
                    .iter()
                    .any(|function| name.eq_ignore_ascii_case(function)) =>
            {
                // These functions can interpret plain quoted strings as resource URLs.
                return Err(parser.new_custom_error(
                    "Indirect CSS resource loading is not supported".to_owned(),
                ));
            }
            Token::Function(_)
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::CurlyBracketBlock => {
                parser.parse_nested_block(|nested| scan(nested, depth + 1))?;
            }
            Token::BadUrl(_)
            | Token::BadString(_)
            | Token::CloseParenthesis
            | Token::CloseSquareBracket
            | Token::CloseCurlyBracket => {
                return Err(parser.new_custom_error("Malformed CSS".to_owned()));
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn validate(css: &str, custom: bool) -> Result<()> {
    let max_bytes = if custom { MAX_CUSTOM } else { MAX_GENERATED };
    if css.len() > max_bytes {
        return Err(Error::StyleTooLarge {
            actual_bytes: css.len(),
            max_bytes,
        });
    }
    let mut input = ParserInput::new(css);
    scan(&mut Parser::new(&mut input), 0)
        .map_err(|_| Error::Safety("CSS contains unsupported syntax or external resources".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_styles_remain_rejected_with_actionable_size_details() {
        for (custom, limit) in [(true, MAX_CUSTOM), (false, MAX_GENERATED)] {
            assert!(matches!(validate(&" ".repeat(limit + 1), custom),
                Err(Error::StyleTooLarge { actual_bytes, max_bytes })
                    if actual_bytes == limit + 1 && max_bytes == limit));
        }
    }
    #[test]
    fn local_styling_and_embedded_raster_images_are_allowed() {
        assert!(validate("[data-lct-part=\"composer\"] { border-radius: 14px; background: linear-gradient(45deg, #123, #456); }", true).is_ok());
        assert!(validate(
            "a { background: url(\"data:image/png;base64,YWJj\"); }",
            true
        )
        .is_ok());
    }
    #[test]
    fn remote_resources_and_escaped_equivalents_are_rejected() {
        for css in [
            "@import 'https://example.invalid/a.css';",
            r"@i\6dport 'https://example.invalid/a.css';",
            "a { background: url(https://example.invalid/a.png); }",
            r"a { background: u\72l('https://example.invalid/a.png'); }",
            "a { background: image-set('https://example.invalid/a.png' 1x); }",
            "a { background: src('https://example.invalid/a.png'); }",
            "a { background: url(file:///C:/private.png); }",
            "a { background: url(data:image/svg+xml;base64,YWJj); }",
        ] {
            assert!(validate(css, true).is_err(), "{css}");
        }
    }
}
