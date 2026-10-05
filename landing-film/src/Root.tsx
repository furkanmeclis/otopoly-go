import { Composition, type CalculateMetadataFunction } from "remotion";
import { ScrollFilm, type FilmProps } from "./ScrollFilm";
import { FILM_FPS, FILM_FRAMES, SIZES } from "./lib/stage";

const calculateMetadata: CalculateMetadataFunction<FilmProps> = ({ props }) =>
  SIZES[props.layout];

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ScrollFilm"
      component={ScrollFilm}
      durationInFrames={FILM_FRAMES}
      fps={FILM_FPS}
      width={1600}
      height={900}
      defaultProps={{ theme: "light", layout: "landscape" } satisfies FilmProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
