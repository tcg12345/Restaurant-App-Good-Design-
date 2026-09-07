"""Isolated PDF text decoder. Input <=2 MB; no rendering, scripts, or network."""
import io
import resource
import sys


def main():
    resource.setrlimit(resource.RLIMIT_CPU,(10,10))
    # macOS does not reliably implement RLIMIT_AS; retain its system limit.
    if sys.platform!='darwin':
        resource.setrlimit(resource.RLIMIT_AS,(1024**3,1024**3))
    from pypdf import PdfReader,overwrite_configuration
    limits={setting:8_000_000 for setting in ('zlib_maximum_output_length','lzw_maximum_output_length',
                    'run_length_maximum_output_length','array_based_stream_maximum_output_length',
                    'maximum_declared_stream_length')}
    overwrite_configuration(**limits,jbig2dec_binary=None,page_tree_maximum_entries=1000,
                            xform_maximum_invocations_per_extraction=100)
    body=sys.stdin.buffer.read(2_000_001)
    if len(body)>2_000_000 or not body.startswith(b'%PDF-'): raise ValueError('invalid_pdf')
    reader=PdfReader(io.BytesIO(body),strict=False)
    if reader.is_encrypted: raise ValueError('encrypted_pdf')
    if len(reader.pages)>12: raise ValueError('pdf_page_limit')
    parts=[];count=0
    for page in reader.pages:
        stream=page.get_contents()
        if stream and len(stream.get_data())>8_000_000: raise ValueError('pdf_stream_limit')
        text=page.extract_text() or ''
        count+=len(text)
        if count>100_000: raise ValueError('pdf_text_limit')
        parts.append(text)
    sys.stdout.write('\n'.join(parts))


if __name__=='__main__':
    try: main()
    except Exception as error:
        sys.stderr.write(type(error).__name__+': '+str(error)[:160]);raise SystemExit(1)
