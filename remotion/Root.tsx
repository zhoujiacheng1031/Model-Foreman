import { Composition } from 'remotion'
import { ForemanSealIntro } from './ForemanSealIntro'

export function RemotionRoot() {
  return <Composition id="ForemanSealIntro" component={ForemanSealIntro} durationInFrames={132} fps={30} width={1280} height={720} />
}
